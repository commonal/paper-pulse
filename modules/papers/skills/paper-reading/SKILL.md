---
name: paper-reading
description: "Read and critically explain one specific research paper, or a small explicitly named set for direct comparison, together with directly associated supplementary material. Use when the user provides or identifies a concrete paper by PDF, title, DOI, or arXiv page and asks what problem it solves, the author's core idea, whether it is worth close reading, how experiments support the claims, how a figure/module/formula works, what the limitations or reproducibility risks are, or how to present it in a group meeting. The paper's official repository may be used only as supporting evidence. Also use to revise a paper-reading HTML page previously produced from that paper. Do not use for broad literature discovery, batch paper collection, URL/citation verification, full-paper translation, generic academic writing, standalone repository review, formal peer-review drafting, or general HTML development."
license: Apache-2.0
metadata:
  version: "1.1.0"
  category: "academic-research"
  spec: "agentskills.io"
  requires: "Concrete paper content or identifier; Python 3 is only needed for optional validation and HTML bridge scripts."
---

# Research Paper Reading

## Activation contract

Activate this skill only when the task is anchored to a concrete research paper or a small explicitly named comparison set.

Valid anchors include:

- an uploaded paper PDF;
- a paper title, DOI, arXiv identifier, or official paper page;
- supplementary material or an official repository tied to an identified paper;
- an existing paper-reading HTML page produced from an identified paper.

Do not activate it merely because the request contains words such as “paper,” “research,” “review,” “PDF,” “HTML,” or “GitHub.” Route broad discovery, bibliography verification, manuscript writing, full translation, repository-only analysis, and general webpage work to their dedicated workflows.

## Operating objective

Recover the author's reasoning before polishing wording:

```text
research problem
  -> limitation of prior approaches
    -> key design action
      -> change in information flow or objective
        -> experimental evidence
          -> supported conclusion and remaining uncertainty
```

Read quickly enough to establish the whole argument first. Defer isolated terminology and derivation questions until they affect the central claim, the experiment, or reproducibility.

## Select the minimum sufficient mode

| User intent | Mode | Required depth |
|---|---|---|
| “What does this paper do?” “Is it worth reading?” | Quick screen | Abstract, main figure, conclusion, principal results, quality gate |
| “Explain the paper / author's idea” | Standard interpretation | Quick screen plus Introduction, method overview, evidence and limitations |
| “Explain Figure 2 / module / Equation 5” | Focused deep read | Requested local content plus enough surrounding context to avoid distortion |
| “Derive the formulas / help reproduce it” | Method and reproduction | Full method, notation, tensor/data flow, training and implementation evidence |
| “Prepare a group-meeting explanation” | Presentation interpretation | Standard interpretation recast as a teachable narrative |
| “Compare these named papers” | Direct comparison | Apply the same evidence frame to each paper; compare only commensurable claims |
| “Create or revise the paper-reading HTML” | HTML extension | Complete the relevant reading mode first, then load the HTML references |

Do not force the full template when the user asks a narrow question.

## Source acquisition and evidence order

1. Read the paper itself as the primary source.
2. Inspect page renders for figures, tables, equations, captions, or layouts that text extraction cannot preserve.
3. Read supplementary material when a claim, experiment, or implementation detail depends on it.
4. Use the official repository only to clarify configurations, preprocessing, code-path behavior, or reproducibility.
5. Use external sources only to explain background concepts or verify unstable metadata; label them separately.

Prefer the published or author-provided paper version. When versions differ, state which version was read. Never reconstruct unavailable numbers, equations, captions, or settings from memory.

## Core workflow

### 1. Build a first-pass paper map

Scan the title and publication context, Abstract, main architecture or method figure, principal result tables, Conclusion, and appendix/supplement index.

Record:

- task, inputs, outputs, and evaluation setting;
- the prior limitation the authors target;
- the method's one central action and supporting modules;
- the strongest claimed result;
- unresolved terms, assumptions, or suspicious claims.

### 2. Read the Abstract as claims, not proof

Extract:

- problem;
- method and claimed novelty;
- reported effect;
- claims that still require verification in the experiments or method.

### 3. Check the experimental evidence before committing to full method reading

Inspect datasets and splits, metrics, baselines, training conditions, added data or pretraining, main results, ablations, statistical stability, efficiency, qualitative analysis, and leakage risks.

Give an explicit reading decision:

- **A — close read:** material problem, substantive method difference, and reasonably sufficient evidence;
- **B — selective read:** useful idea or experiment, but limited novelty, evidence, or applicability;
- **C — background only:** relevant context with little need for method-level investment;
- **D — stop:** weak relevance, unfair comparison, or evidence too incomplete for the user's goal.

This decision is a reading-priority judgment, not an acceptance recommendation.

### 4. Deep-read only what the task justifies

For Introduction, reconstruct the argument from importance to prior limitation to proposed solution.

For each method module, explain:

```text
purpose -> input -> operation -> output -> connection to other modules -> expected benefit -> validating evidence
```

For each important equation, explain:

```text
question answered -> symbols -> operation -> intuition -> role in the whole method -> implementation implication
```

For Related Work, identify the actual technical line, nearest alternatives, omitted close work, and whether the claimed gap survives comparison.

### 5. Synthesize claims, evidence, and limits

Separate:

- what the authors claim;
- what the paper directly demonstrates;
- what supplementary material or repository evidence adds;
- what is an explanatory inference;
- what remains unverified.

End with the paper's transferable value for the user's research or presentation goal, without inventing novelty or generality.

## Evidence notation

Cite the narrowest available location, for example:

```text
[Paper §3.2]
[Paper Fig. 2]
[Paper Table 4]
[Supplement §B]
[Official repo: configs/train.yaml]
[External background]
[Interpretive inference]
```

Any claim about being better, SOTA, robust, efficient, or generalizable must name the dataset, metric, comparator, magnitude, and fairness conditions when available.

## Output contract

Start with the conclusion the user needs, then show the supporting reasoning. Use the closest structure in [references/output-contracts.md](references/output-contracts.md).

A complete standard interpretation should normally contain:

1. one-sentence positioning;
2. problem and prior bottleneck;
3. author's core idea in plain language;
4. end-to-end processing flow;
5. experimental setup and strongest evidence;
6. quality, fairness, and reproducibility judgment;
7. limitations and unresolved questions;
8. relevance to the user's current research or presentation.

Use exact values only when verified. Prefer concise paragraphs over mechanical chapter summaries.

## Reference routing

Load only the files required for the current mode:

- Detailed two-pass reading procedure: [references/reading-workflow.md](references/reading-workflow.md)
- Output structures and comparison template: [references/output-contracts.md](references/output-contracts.md)
- Evidence, fairness, ablation, and reproducibility checks: [references/evidence-quality.md](references/evidence-quality.md)
- Remote-sensing-specific leakage and multimodal checks: [references/remote-sensing.md](references/remote-sensing.md)
- Paper-reading HTML structure and write-back contract: [references/html-contract.md](references/html-contract.md)
- HTML layout: [references/html-layout.md](references/html-layout.md)
- Formula rendering: [references/katex.md](references/katex.md)
- Mermaid diagrams: [references/mermaid.md](references/mermaid.md)

Do not load the HTML, KaTeX, or Mermaid references unless the requested deliverable actually needs them.

## HTML extension

Treat HTML as an optional delivery format, not the skill's main purpose. Only use it for an identified paper and a paper-reading deliverable.

Use [assets/minimal-paper.html](assets/minimal-paper.html) as the starting asset. Before delivery, run:

```bash
python3 scripts/validate_paper_html.py path/to/paper.html --contract --strict --json
```

The local annotation bridge is optional:

```bash
python3 scripts/bridge.py --page /absolute/path/to/paper.html --log /absolute/path/to/requests.jsonl --token <local-token>
```

Never place API keys in the HTML. The bridge records and writes annotation requests; it does not generate explanations.

## Completion criteria

Before returning the result, verify that:

- the response answers the user's requested mode rather than reproducing every section;
- the central idea is expressed as bottleneck, design action, and mechanism;
- quality judgments are traceable to experiments or clearly marked as uncertainty;
- paper facts, repository facts, external background, and inference are distinguishable;
- figures, tables, and equations used in the explanation were actually inspected;
- inaccessible or unverified content is disclosed rather than guessed;
- optional HTML output passes the strict validator.
