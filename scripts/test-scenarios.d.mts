export interface Scenario {
  name: string
  run: () => unknown
}

export function runScenarios(scenarios: readonly Scenario[], between?: () => unknown): Promise<void>
export function scenarioName(template: string, row: unknown, index: number): string
