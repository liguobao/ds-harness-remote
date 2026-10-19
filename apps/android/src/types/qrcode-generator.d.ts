declare module 'qrcode-generator' {
  interface QrCode {
    addData(data: string): void
    make(): void
    getModuleCount(): number
    isDark(row: number, column: number): boolean
  }

  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

  function qrcode(typeNumber: number, errorCorrectionLevel: ErrorCorrectionLevel): QrCode

  export default qrcode
}
