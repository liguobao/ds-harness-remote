import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { useState, type MutableRefObject } from 'react'
import { Image } from 'react-native'
import { Alert } from '../../ui/alert'
import { strings } from '../../locales/i18n'
import { useBrowseMemory } from '../../services/browse-memory'
import { useAppStore } from '../../state/store'
import type { PromptImage, RemoteSession } from '../../types'
import {
  documentImageReadBudget,
  formatFileBytes,
  isDirectTransportMode,
  isTextFile,
  isValidUtf8Text,
  isVideoFile,
  MAX_INLINE_TEXT_BYTES,
  MAX_TOTAL_INLINE_TEXT_BYTES,
  readDocumentImageBase64,
  sanitizeUploadFileName,
  workspaceUploadMaxBytes,
  type StagedFile,
} from '../chat-files'
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

function resolveDiskFileSize(uri: string, fallbackSize?: number | null): number {
  try {
    const statSize = new File(uri).size
    if (typeof statSize === 'number' && Number.isFinite(statSize) && statSize > 0) {
      return statSize
    }
  } catch {
    // Fall back to picker metadata if direct File.size lookup is unavailable.
  }
  if (typeof fallbackSize === 'number' && Number.isFinite(fallbackSize) && fallbackSize > 0) {
    return fallbackSize
  }
  return 0
}

function makeStagedId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function useChatAttachments({ session, memoryKey, images, setImages, stagedFiles, setStagedFiles, sessionGenerationRef }: Options) {
  const [pickingImages, setPickingImages] = useState(false)
  const [pickingFiles, setPickingFiles] = useState(false)

  const canAttachImages = session !== undefined && (sessionImageLimits(session) !== undefined
    || session.backend === 'antigravity' || session.backend === 'cursor' || session.backend === 'codex')

  const pickImage = async (source: 'camera' | 'library') => {
    if (session === undefined) return

    const limits = sessionImageLimits(session)
    const maxAllowed = limits?.maxImagesPerMessage ?? 4
    const remaining = Math.max(0, maxAllowed - images.length)
    if (source === 'camera' && canAttachImages && remaining === 0) {
      Alert.alert(strings.chat.imageLimitTitle, strings.chat.tooManyImages(maxAllowed))
      return
    }

    const targetSessionId = session.sessionId
    const capturedGen = sessionGenerationRef.current
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
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, base64: canAttachImages })
        : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsMultipleSelection: true,
          orderedSelection: true,
          allowsEditing: false,
          quality: 1,
          base64: canAttachImages,
        })
      if (result.canceled || !result.assets || result.assets.length === 0) return

      if (sessionGenerationRef.current !== capturedGen || useAppStore.getState().selectedSession?.sessionId !== targetSessionId) return

      const transportMode = useAppStore.getState().connection.stats.mode
      const maxUploadBytes = workspaceUploadMaxBytes(transportMode)
      const direct = isDirectTransportMode(transportMode)

      const pickedImages: PromptImage[] = []
      const pickedFiles: StagedFile[] = []

      for (const asset of result.assets) {
        const isVideo = asset.type === 'video'
          || (asset.mimeType?.toLowerCase().startsWith('video/') ?? false)
          || (asset.fileName ? isVideoFile(asset.fileName, asset.mimeType) : false)

        // Sessions without direct image input can still receive images as workspace files.
        if (isVideo || !canAttachImages) {
          const mimeType = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg')
          const name = sanitizeUploadFileName(asset.fileName, mimeType, asset.uri)
          const realSize = resolveDiskFileSize(asset.uri, asset.fileSize)
          if (realSize <= 0) {
            Alert.alert(strings.chat.filePickerFailedTitle, strings.chat.fileSizeUnavailable(name))
            continue
          }
          if (realSize > maxUploadBytes) {
            Alert.alert(
              strings.chat.filePickerFailedTitle,
              strings.chat.fileTooLargeForTransport(name, formatFileBytes(maxUploadBytes), direct),
            )
            continue
          }
          pickedFiles.push({
            id: makeStagedId(),
            name,
            size: realSize,
            mimeType,
            uri: asset.uri,
            ...(typeof asset.duration === 'number' && Number.isFinite(asset.duration) && asset.duration > 0
              ? { durationMs: asset.duration }
              : {}),
          })
          continue
        }

        try {
          if (asset.base64 && asset.base64.length > 0) {
            pickedImages.push(promptImageFromAsset(asset))
          } else {
            const fileObj = new File(asset.uri)
            const currentMemoryImages = useBrowseMemory.getState().entries[memoryKey]?.images ?? EMPTY_IMAGES
            const stagedBytes = [...currentMemoryImages, ...pickedImages].reduce((acc, img) => acc + img.bytes, 0)
            const base64 = await readDocumentImageBase64(fileObj, stagedBytes, limits)
            const dim = asset.width > 0 && asset.height > 0 ? { width: asset.width, height: asset.height } : await imageSize(asset.uri)
            pickedImages.push(promptImageFromBase64({
              uri: asset.uri,
              base64,
              ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
              ...(asset.fileName ? { name: asset.fileName } : {}),
              width: dim.width,
              height: dim.height,
            }))
          }
        } catch {
          Alert.alert(strings.chat.imagePickerFailedTitle, strings.chat.imagePickerFailedBody)
        }
      }

      if (sessionGenerationRef.current !== capturedGen || useAppStore.getState().selectedSession?.sessionId !== targetSessionId) return

      if (pickedImages.length > 0) {
        const next = [...images, ...pickedImages]
        const problem = validatePromptImages(next, limits)
        if (problem !== undefined) {
          Alert.alert(strings.chat.imageLimitTitle, problem)
        } else {
          setImages(next)
        }
      }

      if (pickedFiles.length > 0) {
        setStagedFiles(current => [...current, ...pickedFiles])
      }
    } catch {
      Alert.alert(
        strings.chat.imagePickerFailedTitle,
        strings.chat.imagePickerFailedBody,
      )
    } finally {
      setPickingImages(false)
    }
  }

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
      const transportMode = useAppStore.getState().connection.stats.mode
      const maxUploadBytes = workspaceUploadMaxBytes(transportMode)
      const direct = isDirectTransportMode(transportMode)

      const currentImages = useBrowseMemory.getState().entries[memoryKey]?.images ?? EMPTY_IMAGES
      let stagedImagesCount = currentImages.length
      let stagedImagesBytes = currentImages.reduce((acc, img) => acc + img.bytes, 0)
      let stagedTextBytes = stagedFiles.reduce((acc, f) => acc + (typeof f.content === 'string' ? f.size : 0), 0)

      for (const asset of result.assets) {
        const rawName = asset.name ?? 'file'
        const ext = rawName.split(/[?#]/, 1)[0]?.split('.').at(-1)?.toLowerCase()
        const isImage = asset.mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext ?? '')

        const fileObj = new File(asset.uri)
        const realSize = resolveDiskFileSize(asset.uri, asset.size)
        if (realSize <= 0) {
          Alert.alert(strings.chat.filePickerFailedTitle, strings.chat.fileSizeUnavailable(rawName))
          continue
        }

        if (isImage && canAttachImages) {
          const maxAllowed = limits?.maxImagesPerMessage ?? 4
          if (stagedImagesCount >= maxAllowed) {
            Alert.alert(strings.chat.imageLimitTitle, strings.chat.tooManyImages(maxAllowed))
            continue
          }
          if (realSize > imageBudget.maxImageBytes) {
            Alert.alert(strings.chat.imageLimitTitle, strings.chat.imageTooLarge(rawName, formatFileBytes(imageBudget.maxImageBytes)))
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
              name: rawName,
              width: imgDim.width,
              height: imgDim.height,
            })
            newImages.push(image)
            stagedImagesCount += 1
            stagedImagesBytes += image.bytes
          } catch {
            Alert.alert(strings.chat.imagePickerFailedTitle, strings.chat.imagePickerFailedBody)
          }
          continue
        }

        const safeName = sanitizeUploadFileName(rawName, asset.mimeType, asset.uri)
        if (isTextFile(rawName, asset.mimeType) && realSize <= MAX_INLINE_TEXT_BYTES && stagedTextBytes + realSize <= MAX_TOTAL_INLINE_TEXT_BYTES) {
          try {
            const textContent = await fileObj.text()
            if (!isValidUtf8Text(textContent)) {
              Alert.alert(strings.chat.filePickerFailedTitle, `“${rawName}” 包含非有效 UTF-8 字符或控制字符，已跳过。`)
              continue
            }
            newStagedFiles.push({
              id: makeStagedId(),
              name: safeName,
              size: realSize,
              mimeType: asset.mimeType ?? 'text/plain',
              uri: asset.uri,
              content: textContent,
            })
            stagedTextBytes += realSize
          } catch {
            Alert.alert(strings.chat.filePickerFailedTitle, strings.chat.filePickerFailedBody)
          }
          continue
        }

        if (realSize > maxUploadBytes) {
          Alert.alert(
            strings.chat.filePickerFailedTitle,
            strings.chat.fileTooLargeForTransport(rawName, formatFileBytes(maxUploadBytes), direct),
          )
          continue
        }

        newStagedFiles.push({
          id: makeStagedId(),
          name: safeName,
          size: realSize,
          mimeType: asset.mimeType ?? 'application/octet-stream',
          uri: asset.uri,
        })
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
        setStagedFiles(current => [...current, ...newStagedFiles])
      }
    } catch {
      Alert.alert(strings.chat.filePickerFailedTitle, strings.chat.filePickerFailedBody)
    } finally {
      setPickingFiles(false)
    }
  }

  return {
    attachmentPicking: pickingImages || pickingFiles,
    pickImages: () => pickImage('library'),
    takePhoto: () => pickImage('camera'),
    pickFiles,
  }
}

/** Resolve image dimensions for files that arrive without picker metadata (document picker). */
function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject)
  })
}
