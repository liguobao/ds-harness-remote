# Product

## Register

product

## Users

Developers who run DeepSeek Harness on more than one workstation or server and want their local Harness UI—or Android—to control a paired remote Harness with optional, explicitly enabled terminal and development-service preview access.

## Product Purpose

DSH Remote is a secure remote control surface for DeepSeek Harness. The Plugin exposes the current machine as a Host and always adds a Remote workspace entry for controlling other owned Hosts; there is no Client mode switch. The user chooses an owned Host and one of its working directories locally, then continues in the native Harness UI while API calls execute on that Host. Harness and the workspace remain on the selected Host; sessions are never migrated or merged. Android uses the same secure channel.

## Repository Boundary

This repository implements the dual-role Harness Plugin, its Web client face, Android, shared protocol/crypto/transport packages, and mock interoperability tools. It also includes a minimal single-account Relay Server in `apps/server`. The full Remote Web, Admin backend, Server database and migrations remain outside this repository.

The Server design and Remote Protocol remain first-class specifications in `docs/server.md` and `docs/protocol.md`. The separate Server project implements the full Server, Remote Web and Admin site. The minimal self-hosted subset is documented in `apps/server/README.md`.

## Brand Personality

Quiet, precise, trustworthy. The interface should feel familiar to users of Codex, ChatGPT, Linear, and GitHub Mobile: focused on the current task, clear about connection and security state, and free of decorative ceremony.

## Anti-references

Do not resemble a traditional infrastructure admin console, a marketing landing page, a remote desktop, or a terminal. Avoid dashboard card grids, oversized metrics, excessive status colors, decorative gradients, novelty controls, and security claims that hide platform limitations.

## Design Principles

1. Put the active conversation first; navigation and connection detail support it.
2. Make permission decisions explicit, contextual, and impossible to confuse with ordinary chat actions.
3. Show connection truth plainly, including offline, relay, degraded, and platform-security states.
4. Preserve familiar client patterns so the interface disappears into the developer's workflow.
5. Keep remote authority within Harness permissions and never imply that Remote grants broader access.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Support complete keyboard navigation, visible focus, screen-reader names, non-color status cues, readable contrast, touch targets suitable for mobile use, and reduced-motion preferences. Error and connection states must use plain language rather than raw protocol or server failures.
