---
name: principle-encode-lessons-in-structure
description: "Apply when you catch yourself writing the same instruction a second time, or notice a recurring correction. Encode the rule as a lint, metadata flag, runtime check, or script instead of more text."
disable-model-invocation: true
---

# Encode Lessons in Structure

Encode recurring fixes in mechanisms instead of instructions. When you catch yourself writing the same instruction a second time:

1. Ask whether a lint rule, metadata flag, runtime check, or script could enforce it.
2. If so, encode it and delete the instruction.
3. If the lesson needs judgment and cannot be encoded, make the instruction more prominent and add an example of the failure mode.

**Pick the strongest mechanism.** When several would work, choose the strongest the situation allows (an unrepresentable state that cannot compile, then a lint or banned API that fails CI, then a canonical helper, then a runtime check). Agents copy whatever the surrounding code does, so a weaker guard becomes the next template.

**Corollary:** If the fix is structural, only use the structural fix. The instruction is the symptom.

**Close the loop.** Treat every human correction and failed check as a learning signal. Decide whether it is a one-off or a pattern, then route it to the right layer. A one-off goes to a memory note, a recurring fix to a skill or lint rule, and a systemic issue to a principle. Apply it now or create a concrete todo. "I'll keep that in mind" does not persist, and fixing one instance while leaving the recurring pattern intact is not a fix.
