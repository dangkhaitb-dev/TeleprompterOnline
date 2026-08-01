const fs = require('fs');
const path = require('path');

const srcDir = '/Users/macos/Downloads/solprompter-teleprompter-guides-cluster-v2-reviewed';
const destDir = '/Users/macos/Documents/VPromter copy/_templates/_data/articles';

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.md') && !f.startsWith('00') && !f.startsWith('09') && !f.startsWith('1'));

function parseMarkdown(content) {
    const lines = content.split('\n');
    let frontmatter = {};
    let isFrontmatter = false;
    let bodyLines = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '---') {
            if (!isFrontmatter && i === 0) {
                isFrontmatter = true;
                continue;
            } else if (isFrontmatter) {
                isFrontmatter = false;
                continue;
            }
        }
        
        if (isFrontmatter) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > -1) {
                const key = line.slice(0, colonIdx).trim();
                let val = line.slice(colonIdx + 1).trim();
                if (val.startsWith('"') && val.endsWith('"')) {
                    val = val.slice(1, -1);
                }
                frontmatter[key] = val;
            }
        } else {
            bodyLines.push(line);
        }
    }
    
    return { frontmatter, bodyLines };
}

function processBlocks(bodyLines) {
    const blocks = [];
    let i = 0;
    while (i < bodyLines.length) {
        const line = bodyLines[i].trim();
        if (!line) {
            i++;
            continue;
        }
        
        if (line.startsWith('# ')) {
            // Title, ignore
            i++;
            continue;
        }
        
        if (line.startsWith('**Reviewed by') || line.startsWith('**Breadcrumb:**')) {
            i++;
            continue;
        }
        
        if (line.startsWith('## Table of contents')) {
            blocks.push({
                type: 'toc',
                title: 'Table of contents'
            });
            i++;
            while (i < bodyLines.length && (bodyLines[i].match(/^\d+\./) || !bodyLines[i].trim())) {
                i++;
            }
            continue;
        }
        
        if (line.startsWith('## ')) {
            blocks.push({
                type: 'heading',
                level: 2,
                text: line.slice(3).trim()
            });
            i++;
            continue;
        }
        
        if (line.startsWith('### ')) {
            blocks.push({
                type: 'heading',
                level: 3,
                includeInToc: true,
                text: line.slice(4).trim()
            });
            i++;
            continue;
        }
        
        if (line.startsWith('> ')) {
            blocks.push({
                type: 'quote',
                text: line.slice(2).trim()
            });
            i++;
            continue;
        }
        
        if (line.startsWith('- ')) {
            const listItems = [];
            while (i < bodyLines.length && (bodyLines[i].trim().startsWith('- ') || !bodyLines[i].trim())) {
                if (bodyLines[i].trim().startsWith('- ')) {
                    listItems.push({ text: bodyLines[i].trim().slice(2).trim() });
                }
                i++;
            }
            blocks.push({
                type: 'list',
                style: 'bullets',
                items: listItems
            });
            continue;
        }
        
        if (line.match(/^\d+\.\s/)) {
            // Ordered list
            const listItems = [];
            while (i < bodyLines.length && (bodyLines[i].trim().match(/^\d+\.\s/) || !bodyLines[i].trim())) {
                if (bodyLines[i].trim().match(/^\d+\.\s/)) {
                    listItems.push({ text: bodyLines[i].trim().replace(/^\d+\.\s*/, '').trim() });
                }
                i++;
            }
            blocks.push({
                type: 'list',
                style: 'bullets',
                items: listItems
            });
            continue;
        }
        
        // Convert Markdown links to HTML links
        let html = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        
        blocks.push({
            type: 'paragraph',
            html: html
        });
        i++;
    }
    return blocks;
}

for (const file of files) {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
    const { frontmatter, bodyLines } = parseMarkdown(content);
    
    // Default values if missing
    const slug = frontmatter.slug.replace('/blog/', '').replace(/\/$/, '');
    const isHub = file === '01-teleprompter-guides-hub.md';
    
    const article = {
        "$schema": "../schemas/blog-article.schema.json",
        "slug": slug,
        "published": true,
        "flatUrl": true,
        "title": frontmatter.title,
        "date": "2026-08-01",
        "dateDisplay": "August 1, 2026",
        "modified": "2026-08-01",
        "author": {
            "type": "Organization",
            "name": "The SolPrompter Team",
            "url": "/about"
        },
        "review": {
            "by": "the SolPrompter team",
            "updatedDisplay": "August 1, 2026"
        },
        "category": "Teleprompter Guides",
        "shortName": frontmatter.title.split(':')[0],
        "keywords": ["teleprompter", "speaking on camera", "teleprompter setup", "teleprompter script"],
        "mentions": [],
        "seo": {
            "title": frontmatter.title,
            "description": "Learn how to use a teleprompter effectively with our comprehensive guide on setup, scripting, and natural delivery.",
            "image": "https://solprompter.com/media/blog/solprompter-ai-teleprompter-features-tested/hero.webp"
        },
        "hero": {
            "src": "/media/blog/solprompter-ai-teleprompter-features-tested/hero.webp",
            "alt": "Teleprompter usage guide",
            "width": 1600,
            "height": 836
        },
        "cta": {
            "label": "Open SolPrompter",
            "url": "/"
        },
        "content": processBlocks(bodyLines)
    };
    
    const outName = isHub ? 'teleprompter-guides.json' : `${slug}.json`;
    fs.writeFileSync(path.join(destDir, outName), JSON.stringify(article, null, 2));
    console.log(`Exported ${outName}`);
}
