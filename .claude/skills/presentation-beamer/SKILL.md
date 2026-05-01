---
name: presentation-beamer
description: Create LaTeX Beamer slide decks matching the EN_553_724 style in slides.tex. Use when asked to build, revise, or extend Beamer presentations, convert notes to slides, or include figures/images in lecture or project decks.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Bash
---

# Presentation Beamer Guide

Create Beamer slides in the same style as the reference project deck (`slides.tex`).

## Style Baseline

- Use `\documentclass[10pt,compress,t]{beamer}` and `\usetheme{Boadilla}` unless the user asks otherwise.
- Keep frame content top-aligned (`t`) and concise enough to fit without overflow.
- Remove navigation symbols with `\setbeamertemplate{navigation symbols}{}`.
- Use section break frames via `\AtBeginSection[]{...}` with a centered title box and local table of contents.
- Prefer academic structure:
  - `\titlepage` frame
  - dedicated "Table of Contents" frame
  - section/subsection organization
  - references frame with `allowframebreaks` when bibliography is long

## Content Patterns

- Use Beamer blocks intentionally:
  - `block` for definitions/statements
  - `exampleblock` for worked examples
  - `alertblock` for caveats, questions, or limitations
- Add a backup section at the end of substantial decks:
  - `\appendix`
  - one "Backup Slides" divider frame
  - optional deep-dive/Q&A frames after the divider
- Use short bullet lists with controlled spacing (`\setlength\itemsep{...}`) when density is high.
- Put core equations in display math and keep notation consistent throughout.
- For algorithm slides, use `algpseudocode` and keep pseudocode compact.
- For comparison/process slides, prefer `columns` or `tikzpicture` workflows.

## Image and Figure Guidance

Include images when they improve explanation, not as decoration.

1. Check whether an existing image asset is available in the repo/user-provided path.
2. Add `\usepackage{graphicx}` (already standard in this style).
3. Insert images with explicit sizing:
   - `\includegraphics[width=\linewidth]{...}` for full-width figures
   - `\includegraphics[width=0.48\textwidth]{...}` in two-column layouts
4. Add a one-line caption or context sentence directly on the slide.
5. If no suitable image exists, use TikZ for diagrammatic alternatives.

## Editing Workflow

When asked to create or update a deck:

1. Identify slide objective and audience (class talk, project demo, thesis update, etc.).
2. Build an outline with section/subsection flow before writing frames.
3. Draft frames using the style baseline and block patterns above.
4. Add figures/images where they materially improve comprehension.
5. Keep each frame focused on one claim/idea.
6. Add a backup frame block near the end:
   - `\appendix`
   - `\begin{frame}[t]{Backup Slides}\centering\Large Backup Slides\end{frame}`
7. Auto-compile and validate when `Bash` is available:
   - one-shot build: `latexmk -pdf -interaction=nonstopmode -synctex=1 slides.tex`
   - live auto-compile: `latexmk -pdf -pvc -interaction=nonstopmode -synctex=1 slides.tex`
   - stop watcher with `Ctrl+C`.
8. Prefer Make targets when the project includes this skill's `Makefile`:
   - `make slides` for one-shot build
   - `make watch` for live rebuild
   - `make clean` to remove build artifacts

## Output Expectations

- Produce directly compilable `.tex` content.
- Preserve existing citation commands and bibliography setup when editing.
- Avoid theme/style drift unless the user explicitly requests a different visual style.
- Prefer extending existing macros over introducing many new custom commands.
