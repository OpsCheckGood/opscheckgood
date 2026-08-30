# WordNet morphology exceptions

`verb.exc`, `adj.exc` and `noun.exc` from **WordNet 3.1**, Princeton University.

Each line maps an irregular inflected form to its base form (`led lead`,
`ran run`). They are vendored here because the `wordnet-db` npm package ships
only the `index.*` and `data.*` files, and without the exceptions a lookup of
the past tense a bullet is actually written in finds nothing — which is most of
them.

Consumed at build time by `scripts/build-synonyms.mjs`, which writes
`src/data/vocab/synonyms.json`. Nothing here reaches the browser.

## Licence

WordNet 3.0 licence (BSD-style). Copyright 2011 Princeton University.
Permission is granted to use, copy, modify and distribute this database for any
purpose, provided the copyright notice and this paragraph appear in all copies.
Attribution is required; see the project README.

<https://wordnet.princeton.edu/license-and-commercial-use>
