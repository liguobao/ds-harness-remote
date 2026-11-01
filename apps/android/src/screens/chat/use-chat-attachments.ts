import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { useState, type MutableRefObject } from 'react'
import { Alert, Image } from 'react-native'
import { strings } from '../../locales/i18n'
import { useBrowseMemory } from '../../services/browse-memory'
import { useAppStore } from '../../state/store'
import type { PromptImage, RemoteSession } from '../../types'
import { documentImageReadBudget, formatFileBytes, isTextFile, isValidUtf8Text, MAX_SINGLE_FILE_BYTES, MAX_TOTAL_FILES_BYTES, readDocumentImageBase64, type StagedFile } from '../chat-files'
import { promptImageFromAsset, promptImageFromBase64, sessionImageLimits, validatePromptImages } from '../chat-images'

const EMPTY_IMAGES: PromptImage[] = []

type Options = {
  session: RemoteSession | undefined
  memoryKey: string
  images: PromptImage[]
  setImages: (value: PromptImage[] | ((previous: PromptImage[]) => PromptImage[])) => void
  stagedFiles: StagedFile[]
  setStagedFiles: React.Dispatch<React.SetStateAction<StagedFile[]>>
  sessionGenerationRef: MutableRefObject<number>
}

export function useChatAttachments({ session, memoryKey, images, setImages, stagedFiles, setStagedFiles, sessionGenerationRef }: Options) {
  const [pickingImages, setPickingImages] = useState(false)
  const [pickingFiles, setPickingFiles] = useState(false)
  const pickImage = async (source: 'camera' | 'library') => {
    if (session === undefined) return
    const limits = sessionImageLimits(session)
    const maxAllowed = limits?.maxImagesPerMessage ?? 4
    const remaining = Math.max(0, maxAllowed - images.length)
    if (remaining === 0) {
      Alert.alert(strings.chat.imageLimitTitle, strings.chat.tooManyImages(maxAllowed))
      return
    }
    setPickingImages(true)
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync()
        if (!permission.granted) {
          Alert.alert(strings.chat.cameraPermissionTitle, strings.chat.cameraPermissionBody)
          return
        }
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, base64: true })
        : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: remaining,
          orderedSelection: true,
          allowsEditing: false,
          quality: 1,
          base64: true,
        })
      if (result.canceled) return
      const picked = result.assets.map(promptImageFromAsset)
      const next = [...images, ...picked]
      const problem = validatePromptImages(next, limits)
      if (problem !== undefined) {
        Alert.alert(strings.chat.imageLimitTitle, problem)
        return
      }
      setImages(next)
    } catch {
      Alert.alert(strings.chat.imagePickerFailedTitle, strings.chat.imagePickerFailedBody)
    } finally {
      setPickingImages(false)
    }
  }

  const canAttachImages = session !== undefined && (sessionImageLimits(session) !== undefined
    || session.backend === 'antigravity' || session.backend === 'cursor' || session.backend === 'codex')

  const pickFiles = async () => {
    if (session === undefined) return
    const targetSessionId = session.sessionId
    const capturedGen = sessionGenerationRef.current
    setPickingFiles(true)
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets) return

      if (sessionGenerationRef.current !== capturedGen || useAppStore.getState().selectedSession?.sessionId !== targetSessionId) return

      const newStagedFiles: StagedFile[] = []
      const newImages: PromptImage[] = []
      const limits = sessionImageLimits(session)
      const imageBudget = documentImageReadBudget(limits)
      const currentImages = useBrowseMemory.getState().entries[memoryKey]?.images ?? EMPTY_IMAGES
      let stagedImagesCount = currentImages.length
      let stagedImagesBytes = currentImages.reduce((acc, img) => acc + img.bytes, 0)
      let stagedTextBytes = stagedFiles.reduce((acc, f) => acc + f.size, 0)

      for (const asset of result.assets) {
        const name = asset.name ?? 'file'
        const ext = name.split(/[?#]/, 1)[0]?.split('.').at(-1)?.toLowerCase()
        const isImage = asset.mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext ?? '')

        if (isImage && !canAttachImages) {
          Alert.alert(strings.chat.imageLimitTitle, strings.chat.unsupportedImage(name))
          continue
        }

        const fileObj = new File(asset.uri)
        let realSize = 0
        try {
          const statSize = fileObj.size
          if (typeof statSize === 'number' && Number.isFinite(statSize) && statSize > 0) {
            realSize = statSize
          }
        } catch {
          realSize = 0
        }

        if (realSize <= 0) {
          Alert.alert(strings.chat.filePickerFailedTitle, `无法获取 ${name} 的真实磁盘大小。`)
          continue
        }

        if (isImage) {
          const maxAllowed = limits?.maxImagesPerMessage ?? 4
          if (stagedImagesCount >= maxAllowed) {
            Alert.alert(strings.chat.imageLimitTitle, strings.chat.tooManyImages(maxAllowed))
            continue
          }
          if (realSize > imageBudget.maxImageBytes) {
            Alert.alert(strings.chat.imageLimitTitle, strings.chat.imageTooLarge(name, formatFileBytes(imageBudget.maxImageBytes)))
            continue
          }
          if (stagedImagesBytes + realSize > imageBudget.maxMessageImageBytes) {
            Alert.alert(strings.chat.imageLimitTitle, strings.chat.imagesTooLarge(formatFileBytes(imageBudget.maxMessageImageBytes)))
            continue
          }
          try {
            const base64 = await readDocumentImageBase64(fileObj, stagedImagesBytes, limits)
            const imgDim = await imageSize(asset.uri)
            const image = promptImageFromBase64({
              uri: asset.uri,
              base64,
              ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
              name,
              width: imgDim.width,
              height: imgDim.height,
            })
            newImages.push(image)
            stagedImagesCount += 1
            stagedImagesBytes += image.bytes
          } catch {
            Alert.alert(strings.chat.imagePickerFailedTitle, strings.chat.imagePickerFailedBody)
          }
        } else if (isTextFile(name, asset.mimeType)) {
          if (realSize > MAX_SINGLE_FILE_BYTES) {
            Alert.alert(strings.chat.filePickerFailedTitle, `${name} 超过单文件大小上限 (${formatFileBytes(MAX_SINGLE_FILE_BYTES)})`)
            continue
          }
          if (stagedTextBytes + realSize > MAX_TOTAL_FILES_BYTES) {
            Alert.alert(strings.chat.filePickerFailedTitle, `本次选择的文件合计超过上限 (${formatFileBytes(MAX_TOTAL_FILES_BYTES)})，后续文件已停止读取。`)
            break
          }
          try {
            const textContent = await fileObj.text()
            if (!isValidUtf8Text(textContent)) {
              Alert.alert(strings.chat.filePickerFailedTitle, `“${name}” 包含非有效 UTF-8 字符或控制字符，已跳过。`)
              continue
            }
            newStagedFiles.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name,
              size: realSize,
              mimeType: asset.mimeType ?? 'text/plain',
              uri: asset.uri,
              content: textContent,
            })
            stagedTextBytes += realSize
          } catch {
            Alert.alert(strings.chat.filePickerFailedTitle, `无法读取 ${name}，请确保为有效的 UTF-8 文本文件。`)
          }
        } else {
          Alert.alert(strings.chat.filePickerFailedTitle, `暂不支持二进制文件 “${name}”，请选择代码或文本文件。`)
        }
      }

      if (sessionGenerationRef.current !== capturedGen || useAppStore.getState().selectedSession?.sessionId !== targetSessionId) return

      if (newImages.length > 0) {
        setImages(current => {
          const nextImages = [...current, ...newImages]
          const problem = validatePromptImages(nextImages, limits)
          if (problem !== undefined) {
            Alert.alert(strings.chat.imageLimitTitle, problem)
            return current
          }
          return nextImages
        })
      }

      if (newStagedFiles.length > 0) {
        setStagedFiles(current => {
          let currentBytes = current.reduce((acc, f) => acc + f.size, 0)
          const accepted: StagedFile[] = []
          let exceeded = false
          for (const file of newStagedFiles) {
            if (currentBytes + file.size <= MAX_TOTAL_FILES_BYTES) {
              currentBytes += file.size
              accepted.push(file)
            } else {
              exceeded = true
            }
          }
          if (exceeded) {
            Alert.alert(strings.chat.filePickerFailedTitle, `部分文件超过总附件上限 (${formatFileBytes(MAX_TOTAL_FILES_BYTES)})，未能添加。`)
          }
          return [...current, ...accepted]
        })
      }
    } catch {
      Alert.alert(strings.chat.filePickerFailedTitle, strings.chat.filePickerFailedBody)
    } finally {
      setPickingFiles(false)
    }
  }

  return { canAttachImages, attachmentPicking: pickingImages || pickingFiles, pickImages: () => pickImage('library'), takePhoto: () => pickImage('camera'), pickFiles }
}

/** Resolve image dimensions for files that arrive without picker metadata (document picker). */
function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject)
  })
}
