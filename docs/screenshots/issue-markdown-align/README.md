# Markdown, Math, Code Blocks & File Deliverables Verification Evidence

This directory contains real end-to-end verification screenshots taken on Android Emulator (`DSH_Pixel8:5554`) running `@dsh-remote/android` with Host running DeepSeek Harness.

## Representative Screenshots (3 rows × 2 columns)

| 01. Inline Image & Deliverable File Card | 02. Presented File Read-Only Preview |
| :---: | :---: |
| `01-chat-image-and-file-card.png` | `02-file-preview-navigation.png` |
| **03. ASCII Architecture Diagram with Scroll & Header** | **04. Code Block Wrap Toggle Mode** |
| `03-code-block-ascii-diagram-scroll.png` | `04-code-block-wrap-toggle.png` |
| **05. LaTeX Math Formulas & Vector Torques** | **06. TSID & QP Optimization Math Block** |
| `05-latex-math-vectors-and-formulas.png` | `06-latex-math-qp-optimization.png` |

## Verified Items:
1. **LaTeX Math**:
   - Fixed delimiter matching in `markdown-math.ts` for TeX delimiters `\(` and `\)`, and `\[` and `\]`.
   - Preprocessed `\boldsymbol` and `\bm` to `\mathbf` in `math-svg.ts`, avoiding MathJax metric crashes while rendering bold vectors (`\boldsymbol{\tau}`, `\boldsymbol{\lambda}`, `\boldsymbol{\xi}`) as crisp SVGs.
2. **Code Blocks**:
   - `CodeBlockView` component with language header, `Wrap` / `Scroll` toggle button, and `Copy` button with feedback.
   - Horizontal scroll when unwrapped preserves ASCII diagrams and column alignment.
3. **Files & Deliverables**:
   - File glyph decorator in inline links (`🖼️ 1000000161.png`).
   - `PresentedFileCard` matching DSH Web layout (40x40 tile, `Edited <name>`, `binary` / metadata, tap to open file preview).
   - Structured tool execution extraction for mutations (`write`, `edit`, `str_replace_editor`).
