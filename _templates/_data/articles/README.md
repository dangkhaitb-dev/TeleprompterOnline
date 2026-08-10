# Adding a blog article

Create one JSON file in this directory. The file name is for editors only. The
public URL uses `slug`, which must be the URL-safe form of `title`:

```text
title: "Cách đọc kịch bản tự nhiên"
category: "Product"
                  ↓ npm run build
/blog/product/cach-doc-kich-ban-tu-nhien/index.html
```

Start from an existing article JSON and keep this line so compatible editors
can validate the file:

```json
{
  "$schema": "../schemas/blog-article.schema.json"
}
```

Required top-level fields:

- `published`: use `false` to keep a draft out of the build
- `slug`: lowercase, accent-free words separated by hyphens; it must match `title`
- `category`: the display label; the build derives its URL slug automatically
- `title`, `answer`, `date`, `dateDisplay`, `modified`
- `author.name`
- `review.by`, `review.updatedDisplay`: editorial review attribution shown in the article header
- `seo.title`, `seo.description`, `seo.image`
- `hero.src`, `hero.alt`, `hero.width`, `hero.height`
- `cta.label`, `cta.url`
- `content`: an ordered array of content blocks

Supported block types are `paragraph`, `heading`, `quote`, `list`, `image` and
`endnote`. See `../schemas/blog-article.schema.json` for each block's exact
shape. Paragraph `html` is rendered as trusted HTML, so only use content you
control.

The build automatically calculates lowercase, accent-free slugs for the title
and category, and rejects an invalid title slug or colliding category labels.
It validates required fields, sorts published articles by `date`, adds their
cards to `/blog.html`, creates `/blog/<category>/` archive pages, and writes
each article to `/blog/<category>/<article>/`.
