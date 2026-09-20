"""
OCR for the Manuscript Station. Two pipelines, because printed type and
handwriting are two problems and one model that claims both produces
confident nonsense on the harder one. D-012.

  printed.py      Surya, for printed Devanagari and English. Runs in
                  pipeline/.venv, which is Python 3.13 because PyTorch has no
                  wheels for the Python this machine ships.
  handwriting.py  a vision language model, for manuscript hands. Runs on the
                  system Python: it needs nothing but urllib.
  accuracy.py     character and word error against a held-out set, per
                  pipeline, reported as measured.

Both write the same record: regions in reading order, each with its text, its
confidence and where it sits on the page. Neither ever writes over the other,
and a curator correction is a third record, not an edit of either.
"""
