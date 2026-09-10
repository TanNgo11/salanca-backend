# Write TypeScript

## Source language and types

- Use TypeScript for new application, Admin, test, and configuration source.
  Keep existing `.mjs` operational scripts surgical unless their conversion is
  owned by the requested change.
- Use `.tsx` only for files containing JSX. Never add new `.js` or `.jsx`
  application source.
- Never use `var`, explicit `any`, or `unknown` in application-owned source.
  Name the type (DTO, document, envelope) and narrow with type guards.
  Generated `types/generated/` is not edited by hand.
- Do not apply the frontend Header/section folder layout here. Keep Strapi
  content-types, controllers, services, and routes.
- Use `const` by default and `let` only when reassignment is required.
- Use optional chaining for genuinely optional values and nullish coalescing
  when fallback applies only to `null` or `undefined`. Do not use either to hide
  a broken required invariant.
- Model requests, responses, persistence, configuration, exported contracts,
  cross-module calls, and untrusted input with explicit types.
- Prefer exhaustive handling for serialized domain enums. Avoid broad `object`,
  `Function`, unrestricted index signatures, and double casts.

## Feature organization

- Group feature-only helpers, types, errors, permissions, and mappings inside
  the owning feature folder.
- Split only when the extracted module has a clear interface and improves
  locality or testability. Do not create pass-through helpers or barrels only
  to reduce line count or preserve an obsolete path.
- Preserve Strapi-required entrypoints and conventional folders such as
  `content-types`, `controllers`, `services`, `routes`, `policies`,
  `middlewares`, `config`, `register`, and `bootstrap`.
- Keep framework types and generated Strapi document types visible at their
  true boundaries. Do not conceal incompatibility behind a broad cast.
