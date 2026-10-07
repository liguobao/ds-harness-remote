// Run related variants of one contract without registering one test per row.
// Vitest still owns the first setup and final teardown. Restore the same fixture
// between rows so timers, mocks, credentials and connection state stay isolated.
export async function runScenarios(scenarios, between) {
  const failures = []
  for (const [index, scenario] of scenarios.entries()) {
    if (index > 0) await between?.()
    try {
      await scenario.run()
    } catch (error) {
      failures.push({ name: scenario.name, error })
    }
  }
  if (failures.length === 0) return

  // Keep the first assertion's actual/expected values and stack for Vitest's
  // diff, and include every failed row instead of stopping at the first row.
  const first = failures[0].error
  const error = first instanceof Error ? first : new Error(String(first))
  error.message = failures.map(failure =>
    `${failure.name}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`,
  ).join('\n\n')
  throw error
}

export function scenarioName(template, row, index) {
  const values = Array.isArray(row) ? [...row] : [row]
  const title = template.replace(/%[sidjf]/g, () => String(values.shift()))
    .replace(/\$([\w]+)/g, (match, key) => row?.[key] === undefined ? match : String(row[key]))
  return `${title} [row ${index + 1}]`
}
