# AGENTS.md

Guidance for AI agents working in this repo.

## Agent skills

### Issue tracker

Issues and PRDs live as **GitHub issues** in `nbbaier/micropub-litmus`, managed via the `gh` CLI. External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the **canonical** five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) — label strings equal their role names. See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context**: one `CONTEXT.md` + `docs/adr/` at the repo root. The build also keeps an append-only `docs/implementation-notes.md` running log that feeds ADRs. See `docs/agents/domain.md`.

### Build tracking

The v1 build is driven from `docs/spec.md` (decision-complete) and tracked as a **wayfinder execution map**: GitHub issue [#1](https://github.com/nbbaier/micropub-litmus/issues/1). Tickets are build slices (`wayfinder:task`), one per session, wired with native blocking to follow spec §12 build order. Continue with `/wayfinder #1` — it claims the next frontier ticket. Maintain the append-only `docs/implementation-notes.md` while building.


# Ultracite Code Standards

This project uses **Ultracite** (Biome under the hood) via `ultracite/biome/core` + `ultracite/biome/vitest` (`biome.jsonc`). It enforces strict code quality through automated formatting and linting.

## Quick Reference

- **Format & auto-fix**: `bun run fix` (wraps `ultracite fix`)
- **Check for issues**: `bun run check` (wraps `ultracite check`)
- **Diagnose setup**: `bun x ultracite doctor`
- **Type-check**: `bun run typecheck` (`tsc --noEmit`)

Biome provides robust linting and formatting. Most issues are automatically fixable.

> Stack: TypeScript · Hono · Cloudflare Workers · Durable Objects · R2. The frontend is server-rendered **Hono JSX** (`jsxImportSource: "hono/jsx"`) — not React. The guidance below is scoped to that stack; React/Next/Solid/etc. rules were intentionally dropped.

---

## Core Principles

Write code that is **performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### JSX & HTML (Hono JSX, server-rendered)

- Use plain function components; nest children between tags rather than passing them as props
- Use the `key` prop for elements in iterables (prefer stable IDs over array indices)
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Validate and sanitize all inbound Micropub payloads before echoing them into result fragments; avoid injecting unescaped user-supplied HTML
- Don't use `eval()`

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops (relevant to `parseMicropub` normalization)
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun run fix` before committing to ensure compliance.
