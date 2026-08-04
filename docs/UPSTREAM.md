# Provenance and pinning

This repository owns a pinned copy of the Quartz v5 build machinery. This
document records exactly what was imported and how every dependency is pinned,
so future maintainers can verify and reproduce builds.

## Quartz source

- Upstream: https://github.com/jackyzha0/quartz (v5 line)
- Package version: `5.0.0` (`package.json`)
- Upstream revision: `81db804f54a9a64cdf2cc09e856e562511d143c8`
  (2026-06-09, "fix(themes): callouts and layout issues")
- Import path: the `quartz/` directory was vendored from the Travel Knowledge
  Base's previous implementation, which carried this exact upstream snapshot.

### Local modification (one line)

Compared to upstream `81db804f54a9a64cdf2cc09e856e562511d143c8`, the vendored
copy contains exactly one source change:

```diff
--- a/quartz/util/glob.ts
+++ b/quartz/util/glob.ts
-      gitignore: true,
+      gitignore: false,
```

`content` scanning does not apply repository `.gitignore` rules, so staged
content is indexed exactly as allowlisted. This modification was already
present in the vendored copy and is preserved intentionally; it is the only
difference from the pinned upstream revision.

## Dependency pinning

| Layer                                                | Pin mechanism                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| npm dependencies                                     | `package-lock.json`; installs use `npm ci` only                                |
| Community plugins (browse/search/wikilink machinery) | `quartz.lock.json` records the exact resolved repository and commit per plugin |
| Quartz source                                        | vendored snapshot at the upstream revision above                               |

Plugin installs run `npm run install-plugins`, which installs **from the
lockfile** (`npx quartz plugin install`), cloning each plugin repository at
its recorded commit. Do not switch to `--from-config`, which would install
floating default-branch revisions and break reproducibility.

The 18 pinned community plugins. 15 are enabled; `og-image` is installed but
disabled (the vendored `Head.tsx` imports its `CustomOgImagesEmitterName`
export), and `content-index`/`note-properties` are required at runtime for the
local search index and frontmatter parsing:

| Plugin                     | Commit                                     | Role                                        |
| -------------------------- | ------------------------------------------ | ------------------------------------------- |
| article-title              | `e608ca815e137e22b598094f735bcd8a481dafaa` | enabled                                     |
| breadcrumbs                | `cf2e161425165e1ac713f1feb7250b07fe0250ae` | enabled                                     |
| content-index              | `c3d4f5c85311712c3355cd71da46b28e2d8eba71` | enabled (search index; sitemap/RSS off)     |
| content-page               | `d22fae357ae74a3e97a2f450862f23f5227842c4` | enabled                                     |
| crawl-links                | `43edc6d5182e79bf1b63fed7eb3ba0c7624a1526` | enabled                                     |
| darkmode                   | `c6484f72ebc6ea89339be7cf86ad14b40c47dcc7` | enabled                                     |
| description                | `56dc546614d905ad07dd0da8dd5820e25e5ea97b` | enabled                                     |
| explorer                   | `a2dfd1373abe58ace461ebea0b4e94cb287f894e` | enabled                                     |
| folder-page                | `93304d22e1d7f09f93a33658ec273f7cb8d17793` | enabled                                     |
| footer                     | `6ed61928d3c0178d7cef972ebcbca6a206a2f065` | enabled                                     |
| github-flavored-markdown   | `3eabbaa252ce175665ab3f62e1af25948a83e8b6` | enabled                                     |
| note-properties            | `3cb40141e792a8a9ba9f99553cd436f36411bf8d` | enabled (frontmatter parsing; panel hidden) |
| obsidian-flavored-markdown | `07eaca7b31a537c7c4a0fd2848b1f00014c940af` | enabled                                     |
| og-image                   | `31343c612d02c5fd22ff27a1e6035b2486be75f5` | installed but disabled                      |
| page-title                 | `a1c1fe0a9c6a5ce1acf6efa01d473a7d9850e2a3` | enabled                                     |
| search                     | `0f4c1a233cd03a0f562e13636b89b7708f8e2698` | enabled                                     |
| syntax-highlighting        | `5bfdc2c3f42d3d0326c4e777eb575f3fb68d51fb` | enabled                                     |
| table-of-contents          | `6984305e5dae0830c025450e160f12610406f7a4` | enabled                                     |

## License

`LICENSE.txt` is the upstream MIT license and copyright notice carried with
the vendored Quartz source. The Publisher's own files (scripts, tests,
documentation, configuration) are also MIT-licensed.
