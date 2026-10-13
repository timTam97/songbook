# Melbourne Songs: content

The live songbook, as the public site serves it (`songbook.json`). The
weekly Content export workflow on master commits it here whenever it has
changed, so this branch's log is the book's edit history and the file is
a backup outside AWS. Do not edit this branch by hand.

To restore, deploy a stage whose table is empty with
`SEED_FILE=songbook.json` (see the README on master).
