type Node = Record<string, unknown>
export type Scope = (name: string) => unknown
export function checkShownView(title: unknown, view: unknown): { error?: string; title?: string; view?: Node; interactive?: boolean }
export function viewScope(view: Node, values?: Node): Scope
export function resolve(value: unknown, scope: Scope, fallback?: unknown): unknown
export function asText(value: unknown): string
export function inputDefault(node: Node): unknown
export function choiceValue(option: Node): unknown
export function viewInputs(view: Node): Node[]
export function validateViewAnswer(view: Node, action: string, values: Node): { error?: string }
