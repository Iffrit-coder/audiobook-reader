"""Generate the small PDFs the extraction tests run against.

Each file reproduces one way real-world PDFs trip up text extraction.
Run with:  python3 tests/fixtures/make_fixtures.py   (needs reportlab + Pillow)
"""
import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib import pdfencrypt

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = letter
DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def out(name):
    return os.path.join(HERE, name)


def per_glyph(c, text, x, y, font="Helvetica", size=12):
    """Draw every character as its own text operation, the way many
    typesetters and 'print to PDF' drivers do (kerned / justified text)."""
    c.setFont(font, size)
    for ch in text:
        if ch != " ":
            c.drawString(x, y, ch)
        x += pdfmetrics.stringWidth(ch, font, size)


def make_split_glyphs():
    c = canvas.Canvas(out("split-glyphs.pdf"), pagesize=letter)
    per_glyph(c, "Every letter of this sentence is placed on its own.", 72, H - 100)
    per_glyph(c, "Reading it should still give whole words.", 72, H - 116)
    c.save()


def make_font_change():
    """A word whose first letters are in a different font (drop caps, bold
    run-ins, small caps) arrives as two text items with no gap between them."""
    c = canvas.Canvas(out("font-change.pdf"), pagesize=letter)
    y = H - 100
    x = 72
    for txt, font in [("Th", "Helvetica-Bold"), ("is paragraph starts in bold. A ", "Helvetica"),
                      ("wonder", "Helvetica-Oblique"), ("ful word was half italic.", "Helvetica")]:
        c.setFont(font, 12)
        c.drawString(x, y, txt)
        x += pdfmetrics.stringWidth(txt, font, 12)
    c.save()


def make_no_space_words():
    """Words positioned with gaps but no space characters between them."""
    c = canvas.Canvas(out("no-spaces.pdf"), pagesize=letter)
    c.setFont("Helvetica", 12)
    x = 72
    for w in "These words have no space characters between them.".split():
        c.drawString(x, H - 100, w)
        x += pdfmetrics.stringWidth(w, "Helvetica", 12) + 4
    c.save()


def make_hyphenated():
    c = canvas.Canvas(out("hyphenated.pdf"), pagesize=letter)
    c.setFont("Helvetica", 12)
    lines = ["The reader should join words that were hyphen-",
             "ated at the end of a line, so that each exam-",
             "ple is spoken as one word. Keep New-",
             "York style breaks before capitals."]
    pdfmetrics.registerFont(TTFont("DejaVu", DEJAVU))
    c.setFont("DejaVu", 12)
    for i, l in enumerate(lines):
        c.drawString(72, H - 100 - i * 15, l)
    c.save()


def make_ligatures():
    pdfmetrics.registerFont(TTFont("DejaVu", DEJAVU))
    c = canvas.Canvas(out("ligatures.pdf"), pagesize=letter)
    c.setFont("DejaVu", 12)
    c.drawString(72, H - 100, "The ﬁrst ofﬁce ﬂoor had an eﬃcient staﬀ.")
    c.save()


def make_columns():
    c = canvas.Canvas(out("two-columns.pdf"), pagesize=letter)
    c.setFont("Helvetica", 11)
    left = ["Left column first line of", "the story continues here."]
    right = ["Right column has its own", "separate text to read."]
    for i in range(2):
        c.drawString(72, H - 100 - i * 14, left[i])
        c.drawString(320, H - 100 - i * 14, right[i])
    c.save()


def make_no_eol():
    """Lines laid out with absolute positioning so pdf.js never flags hasEOL."""
    c = canvas.Canvas(out("no-eol.pdf"), pagesize=letter)
    c.setFont("Helvetica", 12)
    for i, l in enumerate(["First line ends here", "second line keeps going."]):
        t = c.beginText(72, H - 100 - i * 15)
        t.textLine(l)
        c.drawText(t)
    c.save()


def make_encrypted():
    enc = pdfencrypt.StandardEncryption("secret", canPrint=1)
    c = canvas.Canvas(out("encrypted.pdf"), pagesize=letter, encrypt=enc)
    c.setFont("Helvetica", 12)
    c.drawString(72, H - 100, "This document needs a password to open.")
    c.save()


def make_cjk():
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiMin-W3"))
    c = canvas.Canvas(out("cjk.pdf"), pagesize=letter)
    c.setFont("HeiseiMin-W3", 14)
    c.drawString(72, H - 100, "日本語の文章です。")
    c.save()


def make_scanned():
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("L", (1700, 400), 255)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(DEJAVU, 60)
    d.text((60, 60), "This page is only a picture.", font=f, fill=0)
    d.text((60, 180), "There is no text layer at all.", font=f, fill=0)
    p = out("_scan.png")
    img.save(p)
    c = canvas.Canvas(out("scanned.pdf"), pagesize=letter)
    c.drawImage(p, 36, H - 250, width=W - 72, height=(W - 72) * 400 / 1700)
    c.save()
    os.remove(p)


def make_headers():
    """Running headers, page numbers, headings and body across 3 pages."""
    c = canvas.Canvas(out("book.pdf"), pagesize=letter)
    for p in range(1, 4):
        c.setFont("Helvetica", 8)
        c.drawString(72, H - 40, "My Book - Downloaded from example.org")
        c.drawString(W / 2, 30, str(p))
        c.setFont("Helvetica-Bold", 20)
        c.drawString(72, H - 100, f"Chapter {p}")
        c.setFont("Helvetica", 12)
        c.drawString(72, H - 130, f"Dr. Smith arrived on page {p}. He was late, e.g. by an hour.")
        c.showPage()
    c.save()


if __name__ == "__main__":
    for fn in [make_split_glyphs, make_font_change, make_no_space_words, make_hyphenated,
               make_ligatures, make_columns, make_no_eol, make_encrypted, make_cjk,
               make_scanned, make_headers]:
        fn()
    print("fixtures written to", HERE)
