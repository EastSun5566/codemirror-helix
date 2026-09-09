# CM5 parity

The CM5 adapter uses the shared offset-based engine for portable motions, selections,
edits, registers, search, history, scrolling, panels, and editor-local state.

## Named expected gap

CodeMirror 5 does not expose the Lezer tree used by CodeMirror 6. The following
syntax-tree commands are intentionally unsupported in v0.1:

- `Alt-o`: select parent syntax node
- `Alt-i`: shrink the syntax selection
- `Alt-n`: select next syntax sibling
- `Alt-p`: select previous syntax sibling

These keys do not change the document or selection and report an informational status
message. Bracket matching uses deterministic text scanning instead. Comment toggling
loads CodeMirror 5's built-in comment addon.
