import type zhCN from './zh-CN'

type WidenMessages<T> = T extends (...args: infer TArgs) => string
  ? (...args: TArgs) => string
  : T extends string
    ? string
    : { readonly [TKey in keyof T]: WidenMessages<T[TKey]> }

export type Messages = WidenMessages<typeof zhCN>
