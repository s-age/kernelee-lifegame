# Gemini Agent Instruction & Architecture Analysis

This file contains an architectural evaluation of the `kernelee-lifegame` repository and guidelines for LLM/Multi-Agent system behavior based on its structure.

## 1. Architectural Foundation: Declarative Control Flow and Side-Effects

This application uses the `kernelee` framework to strictly separate pure business logic from workflow and side-effects.

*   **Reified Control Flow**: Branching, looping, and task termination are not implemented procedurally (e.g., `if/else`, `while`). Instead, they are represented as data (Verbs like `divert`, `abort`, `next`) returned by pipeline stages.
*   **Isolated Side-Effects**: I/O operations and state updates (e.g., writing to `GridState` or `LoopState`) are restricted to specific stages (`effect`, `tap`).
*   **Static Introspection**: Because pipelines are declarative, tools like `kernelee-introspect` (`arch_overview`, `arch_walk`) can statically extract the complete graph of reads, writes, and flow transitions without executing the code.

## 2. Implementation Paradigm: Pure Data Transformation

As verified in `src/compute/life.ts`, the actual domain logic functions (`stepIndexRange`, `diffStats`, etc.) are stripped of execution context.
*   They do not know *when* they are called, *where* they go next, or *what* global state they interact with.
*   They are implemented as Pure Functions that simply receive an input type and return an output type.
*   This makes them highly pluggable and trivial to test (requiring zero mocks for external state or I/O).

## 3. Impact on LLM and Multi-Agent Optimization

This architecture provides extreme efficiency and unique advantages when manipulated by LLMs or Multi-Agent systems (like Google Antigravity):

### A. Bypassing the Discovery Phase (No Context Gathering)
In traditional codebases, agents waste massive compute and token resources spawning sub-agents to `grep` and crawl files to understand implicit dependencies and side-effects.
Here, `introspect` tools output the exact dependency graph (`reads`, `writes`, `divertsTo`) instantly. Agents can skip discovery and directly focus on pure reasoning and implementation.

### B. Extreme Parallelization and Agent Specialization
Because the architecture defines flow and Types (Contracts) upfront with no implicit coupling, Multi-Agent systems should adopt a strict Master-Worker topology:
*   **Architect Agent (Master)**: Reads the introspection tools, manages the overarching flow, and hands out strict Type Contracts.
*   **Worker Agents (Subagents)**: Implemented concurrently. A worker is simply given "Accept Input Type X, Return Output Type Y as a pure function."
*   There is no blocking or serial dependency between worker tasks; fifty distinct compute logic functions could be implemented by fifty agents simultaneously with virtually zero risk of hallucination or integration conflicts.
