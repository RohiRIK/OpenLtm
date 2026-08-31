import difflib, sys

a = open('/home/rohi/tmp_bundle_test.mjs').read()
b = open('/home/rohi/projects/OpenLtm/hooks/GitCommit.bundle.mjs').read()
print("esbuild fresh len", len(a), "committed len", len(b))
sm = difflib.SequenceMatcher(None, a, b)
diffs = 0
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag != 'equal':
        diffs += 1
        if diffs <= 5:
            # Show just length + a safe slice of the differing region
            sa = a[i1:i2]
            sb = b[j1:j2]
            print(tag, "fresh_len", len(sa), "committed_len", len(sb))
            print("  fresh   :", sa[:80].replace('\n', '\\n'))
            print("  committed:", sb[:80].replace('\n', '\\n'))
print("total nonzero opcodes:", diffs)