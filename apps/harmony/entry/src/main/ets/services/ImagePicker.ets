/**
 * 从系统图片选择器取图，压到适合走远端通道的大小，再转成 prompt 里的 image part。
 *
 * 远端协议（dsh `SessionPromptRequest.content`）接受
 * `{ type: 'image', mediaType, data }`，其中 `data` 是标准 base64 的原始图片字节。
 * 手机照片动辄 4–8 MB，直接发会在 Noise 分片里拖很久，所以这里统一缩到长边 1600、
 * JPEG q80 —— 一般 200–600 KB，base64 后仍在 4 MiB 的单条上限内（协议给的分片是 48 KiB/片）。
 */

import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { image } from '@kit.ImageKit';
import { common } from '@kit.AbilityKit';
import { camera, cameraPicker } from '@kit.CameraKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { logInfo, logWarn } from '../util/Log';

export class PickedFile {
  name: string = '';
  base64: string = '';
  bytes: number = 0;
  receiptId: string = '';
}

/** 一条待发送的图片。base64 是标准字母表（协议要求 canonical base64）。 */
export class PickedImage {
  mediaType: string = 'image/jpeg';
  base64: string = '';
  name: string = '';
  /** 预览用像素图（发送后仍可复用于本地回显）。 */
  preview: image.PixelMap | undefined = undefined;
  bytes: number = 0;
}

const MAX_EDGE: number = 1600;
const JPEG_QUALITY: number = 80;

/** 打开系统图片选择器；用户取消返回空数组。 */
export async function pickImages(maxCount: number): Promise<PickedImage[]> {
  const options: photoAccessHelper.PhotoSelectOptions = new photoAccessHelper.PhotoSelectOptions();
  options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
  options.maxSelectNumber = maxCount > 0 ? maxCount : 1;
  const picker: photoAccessHelper.PhotoViewPicker = new photoAccessHelper.PhotoViewPicker();
  const result: photoAccessHelper.PhotoSelectResult = await picker.select(options);
  const uris: string[] = result.photoUris !== undefined ? result.photoUris : [];
  const out: PickedImage[] = [];
  for (const uri of uris) {
    try {
      const picked: PickedImage = await loadAndCompress(uri);
      out.push(picked);
    } catch (error) {
      logWarn('image: 读取失败');
    }
  }
  return out;
}

/** 调用系统相机拍照，压完返回单图数组（取消则空数组）。 */
export async function takePhoto(context: common.UIAbilityContext): Promise<PickedImage[]> {
  const profile: cameraPicker.PickerProfile = {
    cameraPosition: camera.CameraPosition.CAMERA_POSITION_BACK
  };
  const result: cameraPicker.PickerResult = await cameraPicker.pick(
    context,
    [cameraPicker.PickerMediaType.PHOTO],
    profile
  );
  if (result.resultCode !== 0 || !result.resultUri || result.resultUri.length === 0) {
    return [];
  }
  const picked: PickedImage = await loadAndCompress(result.resultUri);
  return [picked];
}

/** 读本地 URI → 解码 → 等比缩到 MAX_EDGE → JPEG → base64。 */
async function loadAndCompress(uri: string): Promise<PickedImage> {
  const file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
  let buffer: ArrayBuffer;
  try {
    const stat = fs.statSync(file.fd);
    const bytes = new Uint8Array(stat.size);
    fs.readSync(file.fd, bytes.buffer);
    buffer = bytes.buffer as ArrayBuffer;
  } finally {
    fs.closeSync(file);
  }
  const source: image.ImageSource = image.createImageSource(buffer);
  const info: image.ImageInfo = await source.getImageInfo();
  const width: number = info.size.width;
  const height: number = info.size.height;
  const longest: number = Math.max(width, height);
  const scale: number = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
  const decodeOptions: image.DecodingOptions = {
    editable: false,
    desiredSize: {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    }
  };
  const pixel: image.PixelMap = await source.createPixelMap(decodeOptions);
  const packer: image.ImagePacker = image.createImagePacker();
  const packOptions: image.PackingOption = { format: 'image/jpeg', quality: JPEG_QUALITY };
  const encoded: ArrayBuffer = await packer.packing(pixel, packOptions);
  const data: Uint8Array = new Uint8Array(encoded);
  const base64: string = new util.Base64Helper().encodeToStringSync(data);
  const picked: PickedImage = new PickedImage();
  picked.mediaType = 'image/jpeg';
  picked.base64 = base64;
  picked.preview = pixel;
  picked.bytes = data.byteLength;
  picked.name = lastNameOf(uri);
  logInfo('image: ' + width + 'x' + height + ' -> ' + Math.round(width * scale) + 'x'
    + Math.round(height * scale) + ' ' + Math.round(data.byteLength / 1024) + 'KB');
  return picked;
}


/** 把一个现成的 PixelMap 压成 PickedImage（相册选择与剪贴板粘贴共用）。 */
export async function compressPixelMap(pixel: image.PixelMap): Promise<PickedImage> {
  const info: image.ImageInfo = await pixel.getImageInfo();
  const width: number = info.size.width;
  const height: number = info.size.height;
  const longest: number = Math.max(width, height);
  const scale: number = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
  // PixelMap.scale 是原地缩放、返回 void
  if (scale < 1) {
    await pixel.scale(Math.max(1, Math.round(width * scale)) / width,
      Math.max(1, Math.round(height * scale)) / height);
  }
  const scaled: image.PixelMap = pixel;
  const packer: image.ImagePacker = image.createImagePacker();
  const packOptions: image.PackingOption = { format: 'image/jpeg', quality: JPEG_QUALITY };
  const encoded: ArrayBuffer = await packer.packing(scaled, packOptions);
  const data: Uint8Array = new Uint8Array(encoded);
  const picked: PickedImage = new PickedImage();
  picked.mediaType = 'image/jpeg';
  picked.base64 = new util.Base64Helper().encodeToStringSync(data);
  picked.preview = scaled;
  picked.bytes = data.byteLength;
  picked.name = 'pasted.jpg';
  return picked;
}

function lastNameOf(uri: string): string {
  const cut: number = uri.lastIndexOf('/');
  const name: string = cut >= 0 ? uri.substring(cut + 1) : uri;
  return name.length > 0 ? name : 'image.jpg';
}

/** 未压缩的原图直接按 MIME 判断，给以后「原图发送」留口子。 */
export function mediaTypeOf(name: string): string {
  const lower: string = name.toLowerCase();
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  return 'image/jpeg';
}

const MAX_PICK_FILE_BYTES = 2 * 1024 * 1024;

/** 打开系统文档选择器，读取受限大小（<= 2MB）的文件字节。 */
export async function pickDocuments(maxCount: number, context: common.UIAbilityContext): Promise<PickedFile[]> {
  const options: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
  options.maxSelectNumber = maxCount > 0 ? maxCount : 1;
  const docPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(context);
  const uris: string[] = await docPicker.select(options);
  const out: PickedFile[] = [];
  for (const uri of uris) {
    const file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    try {
      const stat = fs.statSync(file.fd);
      if (stat.size > MAX_PICK_FILE_BYTES) {
        logWarn('document too large: ' + stat.size);
        continue;
      }
      const bytes = new Uint8Array(stat.size);
      fs.readSync(file.fd, bytes.buffer);
      const picked = new PickedFile();
      picked.name = decodeURIComponent(lastNameOf(uri));
      picked.bytes = bytes.byteLength;
      picked.base64 = new util.Base64Helper().encodeToStringSync(bytes);
      out.push(picked);
    } catch {
      logWarn('document read failed');
    } finally {
      fs.closeSync(file);
    }
  }
  return out;
}
