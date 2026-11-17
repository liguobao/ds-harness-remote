/**
 * 一条「带序号」的出站腿（in-band transport upgrade，`remote.transport.upgrade.v1`）。
 *
 * 升级后的 WebRTC DataChannel 帧在 RTCH 分块之前多一段 12 字节大端序号头
 * （`'DSHU' || uint64 noiseCounter`）。SecureTransport 用 Noise 计数器给它编号，
 * 并在切腿期间对有界乱序帧做重排；旧中继帧（带 wire relay counter）和升级腿帧
 * （带 DSHU 序号）共用同一个 Noise 计数器空间。
 *
 * 该接口只依赖纯数据，避免 SecureTransport ↔ TransportUpgrader ↔ RemoteClientCore
 * 之间因直接引用具体类而产生循环依赖。
 */
export interface SequencedOutboundTransport {
  /** 这条腿实际选中的传输：'lan' | 'p2p' | 'turn'（以主机权威结果更新）。 */
  mode(): string;

  /** 与 mode 同值；单独保留给连接详情/打点，不再从 Host 侧猜测。 */
  selectedTransport(): string;

  /** 发送一帧 Noise 密文：实现负责加序号头并交给底层通道。 */
  sendSequenced(counter: number, ciphertext: Uint8Array): Promise<void>;

  /** 订阅入站帧（已去掉序号头，按 counter 排序前）。返回取消订阅函数。 */
  onSequencedMessage(cb: (counter: number, ciphertext: Uint8Array) => void): () => void;

  /** 订阅关闭事件；返回取消订阅函数。 */
  onClose(cb: (error: Error | undefined) => void): () => void;

  /** 关闭底层通道；重复调用必须安全。 */
  close(): Promise<void>;
}
