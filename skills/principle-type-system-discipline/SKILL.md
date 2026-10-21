---
name: principle-type-system-discipline
description: "Apply when designing types, reviewing a function signature, or writing code in any statically-typed language. Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, exhaust variants, derive from authoritative schemas."
disable-model-invocation: true
---

# Type System Discipline

Make the compiler reject impossible states, mismatched primitives, and unhandled variants. Prefer defining errors and special cases out of existence over proliferating handlers. For TypeScript syntax, see the `typescript-best-practices` skill.

- **Make illegal states unrepresentable.** Model variants as sum types (discriminated unions, enums with payloads, sealed classes, ADTs), not a bag of optional fields where contradictory combinations compile. `{ completed: boolean; completedAt?: Date }` admits `completed: true` with no date. Derive the flag from the date, or model open and done as separate variants. If a bug forces the question "can this combination actually happen?", the type is too loose.
- **Types are constructions, not restrictions.** Build the type up from the values you want instead of carving them out of a looser type with checks. A non-empty list is a head plus a rest, and a valid time range is a start plus a duration, not two timestamps you must keep ordered. No representation is privileged: a list of pairs is an even-length list if you interpret it that way. Choose the shape that cannot build the illegal value and expose the interface callers need on top.
- **Brand semantic primitives.** `UserId` and `OrderId` are strings underneath but should not be interchangeable. Give each its own type, such as a branded intersection in TypeScript or a newtype elsewhere. Validate once at creation, trust the type downstream. If two arguments share a primitive type but mean different things, brand them.
- **External data is untyped until parsed.** RPC payloads, JSON, IPC messages, CLI args, config files, environment variables, database rows. Have a parse function at every boundary that turns unstructured input into the typed model. The **boundary-discipline** principle skill says where to put validation.
- **Don't lie to the type system.** Casts, unsafe coercions, and assertion functions that bypass the compiler are latent runtime crashes. If the compiler can't prove a fact, prove it (validate, narrow, refine the model) or accept that the cast is a hazard.
- **Exhaustive matching is the compiler's job.** When you match on a sum type, compilation must fail if a new variant is added without handling. Use the idiom your language provides, such as a `match` with no wildcard arm in Rust, `-Wincomplete-patterns` in Haskell, or a sealed-class `when` in Kotlin. If adding a variant next month would not tell the next agent where to add a case, the match is not exhaustive.
- **Derive types from authoritative schemas.** When a protocol buffer, OpenAPI spec, GraphQL schema, database migration, design-token file, or another file owns a shape, derive from it instead of hand-rolling a parallel type. See the **encode-lessons-in-structure** principle skill.
- **Strengthen a type only where partiality appears.** A runtime assertion, null check, or "this should never happen" throw marks where a type is too weak. Push that check into the type, then stop. Prefer total functions: `sum` of an empty list is 0, so it takes the plain list; `head` has no answer for an empty list, so it requires a non-empty one. The type system should track the cases each use site must handle, not describe data as precisely as possible.

**The tests:**

- "Can I write a comment explaining when this combination of fields is valid?" If yes, the type is too loose. Split it into a sum type.
- "Do two of my function arguments share a primitive type but mean different things?" Brand them.
- "Where did this `any`, this `as`, this `assertNotNull` come from?" Trace it to the boundary and validate there instead.
- "If a new variant is added next month, will the compiler tell the next agent where to add a case?" If no, the match isn't exhaustive.
- "Is this type duplicating a shape another file owns?" Derive instead.
- "Am I strengthening this type to keep an operation total, or just to be more precise?" If nothing would otherwise panic, keep the plain type.
