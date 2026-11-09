# ds-harness-remote-tui

This package adds a Remote Host entry to a dsh-TUI profile.
It loads the official Host Remote API suite before the Remote entry.
The package targets Harness `0.2.2-rc.1` during development.
The package is not released yet.
Use `ds-harness-remote login` to sign in from the terminal.
Use `ds-harness-remote status` to read the Host status.

The package does not add an entry to the browser or Desktop profile.
Do not run this entry with another Remote Host that uses the same device identity.

## Development checks

Run these commands from the repository root:

```bash
pnpm --filter ds-harness-remote-tui check
pnpm --filter ds-harness-remote-tui build
pnpm --filter ds-harness-remote-tui test
```

The test checks the built bundle and its profile patch.
It does not replace a real dsh-TUI and Android connection test.
