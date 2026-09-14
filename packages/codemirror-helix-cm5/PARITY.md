# CM5 parity

`codemirror-helix-cm5` treats Roberto Vidal's CM6 implementation in this repository
as its compatibility contract, including behavior that differs from Helix itself.

CodeMirror 5 has no Lezer syntax tree, so these commands are unsupported:

- `Alt-o`: select parent syntax node
- `Alt-i`: shrink the syntax selection
- `Alt-n`: select next syntax sibling
- `Alt-p`: select previous syntax sibling

They do not change the document or selection and report an unsupported status. Bracket
matching uses text scanning; comments use CodeMirror 5's comment addon.
