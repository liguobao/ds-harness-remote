/**
 * 语音输入：本机录音 → 16kHz 单声道 16bit WAV → base64，交给主机转写。
 *
 * 主机侧 `speech/transcribe` 收的是 `audioBase64`，内部按 WAV 校验
 * （`@deepseek-ai/dsh-experimental-speech-to-text/wave`，16kHz 单声道）。
 * 所以这里不用 AVRecorder 的 AAC 输出，直接用 AudioCapturer 拿裸 PCM 自己拼 WAV。
 */

import { audio } from '@kit.AudioKit';
import { util } from '@kit.ArkTS';
import { common, abilityAccessCtrl, Permissions } from '@kit.AbilityKit';
import { logInfo, logWarn, logError } from '../util/Log';

const SAMPLE_RATE: number = 16000;
const CHANNELS: number = 1;
const BITS_PER_SAMPLE: number = 16;
/** 一次 read 取多少字节：160ms 的量，短一点手感更跟手。 */
const READ_BYTES: number = 5120;
/** 单条语音上限，避免一次点住不放把内存和请求撑爆。 */
const MAX_SECONDS: number = 60;
/** 太短的录音（误触）直接丢弃，不发请求。 */
const MIN_MILLIS: number = 500;

export class VoiceRecorder {
  private capturer: audio.AudioCapturer | undefined = undefined;
  private chunks: Uint8Array[] = [];
  private totalBytes: number = 0;
  private recording: boolean = false;
  private startedAt: number = 0;
  private readLoop: Promise<void> | undefined = undefined;

  /** 录音权限：首次点麦克风时申请，拒了就一直返回 false。 */
  static async ensurePermission(context: common.UIAbilityContext): Promise<boolean> {
    try {
      const manager = abilityAccessCtrl.createAtManager();
      const permissions: Permissions[] = ['ohos.permission.MICROPHONE'];
      const result = await manager.requestPermissionsFromUser(context, permissions);
      const granted: boolean = result.authResults.length > 0 && result.authResults[0] === 0;
      logInfo('microphone permission granted=' + granted);
      return granted;
    } catch (error) {
      logWarn('microphone permission request failed: ' + (error instanceof Error ? error.message : String(error)));
      return false;
    }
  }

  isRecording(): boolean {
    return this.recording;
  }

  /** 已录时长（毫秒），给界面画计时用。 */
  elapsedMillis(): number {
    if (!this.recording) {
      return 0;
    }
    return Date.now() - this.startedAt;
  }

  async start(): Promise<void> {
    if (this.recording) {
      return;
    }
    this.chunks = [];
    this.totalBytes = 0;
    const options: audio.AudioCapturerOptions = {
      streamInfo: {
        samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000,
        channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
        encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW
      },
      capturerInfo: {
        source: audio.SourceType.SOURCE_TYPE_MIC,
        capturerFlags: 0
      }
    };
    const capturer: audio.AudioCapturer = await audio.createAudioCapturer(options);
    this.capturer = capturer;
    await capturer.start();
    this.recording = true;
    this.startedAt = Date.now();
    this.readLoop = this.pump(capturer);
    logInfo('voice recording started');
  }

  /** 停止录音并返回 WAV 的 base64；太短或没录到东西时返回空串。 */
  async stop(): Promise<string> {
    if (!this.recording) {
      return '';
    }
    this.recording = false;
    const elapsed: number = Date.now() - this.startedAt;
    const capturer: audio.AudioCapturer | undefined = this.capturer;
    this.capturer = undefined;
    if (this.readLoop !== undefined) {
      try {
        await this.readLoop;
      } catch (error) {
        logWarn('voice read loop ended: ' + (error instanceof Error ? error.message : String(error)));
      }
      this.readLoop = undefined;
    }
    if (capturer !== undefined) {
      try {
        await capturer.stop();
      } catch (error) {
        logWarn('capturer stop failed: ' + (error instanceof Error ? error.message : String(error)));
      }
      try {
        await capturer.release();
      } catch (error) {
        logWarn('capturer release failed: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
    logInfo('voice recording stopped bytes=' + this.totalBytes + ' ms=' + elapsed);
    if (elapsed < MIN_MILLIS || this.totalBytes === 0) {
      this.chunks = [];
      this.totalBytes = 0;
      return '';
    }
    const pcm: Uint8Array = this.concat();
    this.chunks = [];
    this.totalBytes = 0;
    return new util.Base64Helper().encodeToStringSync(wrapWave(pcm));
  }

  /** 丢弃当前录音（例如用户中途取消）。 */
  async cancel(): Promise<void> {
    if (!this.recording) {
      return;
    }
    this.recording = false;
    const capturer: audio.AudioCapturer | undefined = this.capturer;
    this.capturer = undefined;
    if (this.readLoop !== undefined) {
      try {
        await this.readLoop;
      } catch (error) {
        logWarn('voice read loop ended while cancelling');
      }
      this.readLoop = undefined;
    }
    if (capturer !== undefined) {
      try {
        await capturer.stop();
        await capturer.release();
      } catch (error) {
        logWarn('capturer cleanup failed');
      }
    }
    this.chunks = [];
    this.totalBytes = 0;
  }

  private async pump(capturer: audio.AudioCapturer): Promise<void> {
    while (this.recording) {
      if (Date.now() - this.startedAt > MAX_SECONDS * 1000) {
        break;
      }
      let buffer: ArrayBuffer;
      try {
        buffer = await capturer.read(READ_BYTES, true);
      } catch (error) {
        logWarn('capturer read failed: ' + (error instanceof Error ? error.message : String(error)));
        break;
      }
      if (buffer.byteLength > 0) {
        this.chunks.push(new Uint8Array(buffer.slice(0)));
        this.totalBytes += buffer.byteLength;
      }
    }
  }

  private concat(): Uint8Array {
    const out: Uint8Array = new Uint8Array(this.totalBytes);
    let offset: number = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** 给裸 PCM 套一个 44 字节的 WAV 头，主机侧按 16kHz/单声道/16bit 校验。 */
function wrapWave(pcm: Uint8Array): Uint8Array {
  const out: Uint8Array = new Uint8Array(44 + pcm.length);
  const view: DataView = new DataView(out.buffer);
  writeAscii(out, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(out, 8, 'WAVE');
  writeAscii(out, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8, true);
  view.setUint16(32, CHANNELS * BITS_PER_SAMPLE / 8, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(out, 36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let index: number = 0; index < text.length; index += 1) {
    target[offset + index] = text.charCodeAt(index);
  }
}
