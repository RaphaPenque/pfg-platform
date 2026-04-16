/**
 * Weekly PDF report generator
 * Serialises ReportData to a temp JSON file, then calls a Python3 script
 * that uses ReportLab to produce the PDF (exact design from build_report_v3.py).
 * Returns the PDF as a Node Buffer.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

export interface ReportData {
  projectName: string;
  projectCode: string;
  customer: string;
  siteName: string;
  startDate: string;
  endDate: string;
  contractType: string;
  shiftPattern: string;
  weekStart: string;  // YYYY-MM-DD
  weekEnd: string;    // YYYY-MM-DD
  pmName: string;
  completedTasks: Array<{ description: string; percentComplete?: number; notes?: string }>;
  delaysLog: Array<{ description: string; duration?: string; agreedWithCustomer?: string }>;
  commentsEntries: Array<{ date: string; entry: string; userName: string }>;
  teamMembers: Array<{ name: string; role: string; shift: string; startDate: string; endDate: string }>;
  workPackages?: Array<{ name: string; plannedStart?: string; plannedFinish?: string; actualStart?: string; actualFinish?: string }>;
  safetyData: { toolboxTalks: number; observations: number; nearMisses: number; incidents: number };
  daysRemaining: number;
  activeTeam: number;
  progressPct: number;
  oemColour: string;  // hex e.g. "#005E60"
}

// ─── Python script template ───────────────────────────────────────────────────

function buildPythonScript(inputJson: string, outputPdf: string): string {
  return `
import sys, json, os, math
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor

# ── Fonts ──────────────────────────────────────────────────────────
NOTO = '/usr/share/fonts/truetype/noto'
try:
    pdfmetrics.registerFont(TTFont('Sans',        f'{NOTO}/NotoSans-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('Sans-Bold',   f'{NOTO}/NotoSans-Bold.ttf'))
    pdfmetrics.registerFont(TTFont('Sans-Medium', f'{NOTO}/NotoSans-Medium.ttf'))
except Exception:
    # Fallback to Helvetica built-ins if NotoSans not present
    from reportlab.pdfbase.pdfmetrics import registerFontFamily
    pdfmetrics.registerFont(TTFont('Sans',        'Helvetica'))
    pdfmetrics.registerFont(TTFont('Sans-Bold',   'Helvetica-Bold'))
    pdfmetrics.registerFont(TTFont('Sans-Medium', 'Helvetica-Bold'))

# ── Load data ─────────────────────────────────────────────────────
with open(${JSON.stringify(inputJson)}, 'r', encoding='utf-8') as f:
    D = json.load(f)

OEM_HEX = D.get('oemColour', '#005E60')
LOGO_PATH = '/home/user/workspace/pfg-platform/client/public/logo-gold.png'
APP_URL = 'https://pfg-platform.onrender.com'

# ── Colours ────────────────────────────────────────────────────────
NAVY   = HexColor('#1A1D23')
GOLD   = HexColor('#F5BD00')
OEM    = HexColor(OEM_HEX)
WHITE  = HexColor('#FFFFFF')
LIGHT  = HexColor('#F4F5F6')
BORDER = HexColor('#E2E4E8')
MUTED  = HexColor('#6B7280')
GREEN  = HexColor('#16A34A')
TEXT   = HexColor('#111827')
BANNER_SUB = HexColor('#99CCCC')
AMBER  = HexColor('#D97706')

W, H = A4
M = 20*mm

# ── Format helpers ────────────────────────────────────────────────
def fmt_date(iso):
    """Convert YYYY-MM-DD to DD Mon YYYY e.g. 13 Apr 2026"""
    if not iso:
        return ''
    try:
        from datetime import datetime
        return datetime.strptime(iso[:10], '%Y-%m-%d').strftime('%d %b %Y')
    except Exception:
        return iso

def week_label(ws, we):
    """e.g. '13 – 19 April 2026' (shared month) or '29 Mar – 4 Apr 2026'"""
    if not ws or not we:
        return ''
    try:
        from datetime import datetime
        s = datetime.strptime(ws[:10], '%Y-%m-%d')
        e = datetime.strptime(we[:10], '%Y-%m-%d')
        if s.month == e.month:
            return f"{s.day} \\u2013 {e.day} {e.strftime('%B %Y')}"
        else:
            return f"{s.strftime('%d %b')} \\u2013 {e.strftime('%d %b %Y')}"
    except Exception:
        return f"{ws} – {we}"

# ── Drawing helpers ───────────────────────────────────────────────
def draw_header(c, page_num=1):
    c.setFillColor(NAVY)
    c.rect(0, H - 22*mm, W, 22*mm, fill=1, stroke=0)
    if os.path.exists(LOGO_PATH):
        c.drawImage(LOGO_PATH, M, H - 17*mm, width=40*mm, height=12*mm,
                    preserveAspectRatio=True, mask='auto')
    c.setFillColor(WHITE)
    c.setFont('Sans', 8)
    c.drawCentredString(W/2, H - 12.5*mm, 'WEEKLY PROJECT REPORT')
    c.setFillColor(GOLD)
    c.setFont('Sans-Bold', 9)
    c.drawRightString(W - M, H - 10*mm, D.get('projectCode', ''))
    c.setFillColor(HexColor('#9CA3AF'))
    c.setFont('Sans', 7)
    c.drawRightString(W - M, H - 16*mm, f'Page {page_num}  |  CONFIDENTIAL')

def draw_footer(c):
    we_label = fmt_date(D.get('weekEnd', ''))
    c.setFillColor(BORDER)
    c.rect(0, 0, W, 10*mm, fill=1, stroke=0)
    c.setFillColor(MUTED)
    c.setFont('Sans', 7)
    c.drawString(M, 3.5*mm, f'\\u00a9 {2026} Powerforce Global  \\u00b7  Customer Report  \\u00b7  {D.get("siteName", "")}')
    c.drawRightString(W - M, 3.5*mm, f'Week ending {we_label}')

def h_line(c, y, x0=None, x1=None, color=None, width=0.3):
    c.setStrokeColor(color or BORDER)
    c.setLineWidth(width)
    c.line(x0 or M, y, x1 or (W - M), y)

def section_heading(c, y, text):
    c.setFillColor(OEM)
    c.rect(M, y - 1*mm, 1.5*mm, 5*mm, fill=1, stroke=0)
    c.setFillColor(TEXT)
    c.setFont('Sans-Bold', 11)
    c.drawString(M + 4*mm, y + 0.5*mm, text)
    return y - 10*mm

def kpi_card(c, x, y, w, h, label, value, sub=None, accent=None):
    col = accent or OEM
    c.setFillColor(LIGHT)
    c.roundRect(x, y, w, h, 2*mm, fill=1, stroke=0)
    c.setFillColor(col)
    c.roundRect(x, y, 3*mm, h, 1.5*mm, fill=1, stroke=0)
    c.setFillColor(TEXT)
    c.setFont('Sans-Bold', 22)
    c.drawCentredString(x + w/2 + 1.5*mm, y + h/2 + 1*mm, str(value))
    c.setFillColor(MUTED)
    c.setFont('Sans', 7)
    c.drawCentredString(x + w/2 + 1.5*mm, y + h/2 - 6*mm, label.upper())
    if sub:
        c.setFillColor(GREEN)
        c.setFont('Sans-Medium', 7)
        c.drawCentredString(x + w/2 + 1.5*mm, y + 3*mm, sub)

def pill(c, x, y, text, bg, fg=None, fs=7):
    if fg is None:
        fg = WHITE
    c.setFont('Sans-Bold', fs)
    tw = c.stringWidth(text, 'Sans-Bold', fs)
    pw, ph = tw + 5*mm, 4*mm
    c.setFillColor(bg)
    c.roundRect(x, y, pw, ph, 1.5*mm, fill=1, stroke=0)
    c.setFillColor(fg)
    c.drawString(x + 2.5*mm, y + 1*mm, text)
    return pw

def wrap_text(c, text, x, y, max_w, font='Sans', size=8.5, line_h=4.5*mm):
    words = str(text).split()
    line = ''
    for word in words:
        test = (line + ' ' + word).strip()
        if c.stringWidth(test, font, size) <= max_w:
            line = test
        else:
            c.setFont(font, size)
            c.drawString(x, y, line)
            y -= line_h
            line = word
    if line:
        c.setFont(font, size)
        c.drawString(x, y, line)
        y -= line_h
    return y

# ══════════════════════════════════════════════════════════════════
# Build the PDF
# ══════════════════════════════════════════════════════════════════
c = canvas.Canvas(${JSON.stringify(outputPdf)}, pagesize=A4)
title = f"{D.get('projectName','')} \\u2014 Weekly Report w/e {fmt_date(D.get('weekEnd',''))}"
c.setTitle(title)
c.setAuthor('Perplexity Computer')

week_str = week_label(D.get('weekStart',''), D.get('weekEnd',''))
period_str = f"{fmt_date(D.get('startDate',''))} \\u2013 {fmt_date(D.get('endDate',''))}"
contract_type = D.get('contractType', 'T&M')
is_ls = contract_type.upper() in ('L/S', 'LS', 'LUMP SUM', 'LUMPSUM')

completed_tasks = D.get('completedTasks', [])
delays_log = D.get('delaysLog', [])
comments_entries = D.get('commentsEntries', [])
team_members = D.get('teamMembers', [])
work_packages = D.get('workPackages', []) or []
safety = D.get('safetyData', {})
days_remaining = D.get('daysRemaining', 0)
active_team = D.get('activeTeam', 0)
progress_pct = D.get('progressPct', 0)
pm_name = D.get('pmName', 'Powerforce Global Project Management')
project_code = D.get('projectCode', '')

# ══════════════════════════════════════════════════════════════════
# PAGE 1
# ══════════════════════════════════════════════════════════════════
draw_header(c, 1)
draw_footer(c)
y = H - 22*mm - 8*mm

# ── PROJECT BANNER ───────────────────────────────────────────────
BH = 32*mm
c.setFillColor(OEM)
c.roundRect(M, y - BH, W - 2*M, BH, 3*mm, fill=1, stroke=0)

c.setFillColor(WHITE)
c.setFont('Sans-Bold', 16)
c.drawString(M + 5*mm, y - 10*mm, D.get('projectName', ''))

meta = [
    [('Site:', D.get('siteName', '')), ('Period:', period_str)],
    [('Scope:', D.get('customer', '')), ('Contract:', contract_type)],
]
for ri, row in enumerate(meta):
    xi = M + 5*mm
    row_y = y - (18 + ri*7)*mm
    for label, val in row:
        c.setFont('Sans-Bold', 8)
        c.setFillColor(BANNER_SUB)
        c.drawString(xi, row_y, label)
        lw = c.stringWidth(label, 'Sans-Bold', 8)
        c.setFont('Sans', 8)
        c.setFillColor(WHITE)
        # Truncate to avoid overflow
        max_lbl_w = W/2 - xi - 5*mm
        truncated = val
        while truncated and c.stringWidth(truncated, 'Sans', 8) > max_lbl_w:
            truncated = truncated[:-2] + '\\u2026'
        c.drawString(xi + lw + 1.5*mm, row_y, truncated)
        xi = W/2

# Reporting week badge
bx = W - M - 38*mm
by = y - BH + 4*mm
c.setFillColor(GOLD)
c.roundRect(bx, by, 35*mm, 20*mm, 2*mm, fill=1, stroke=0)
c.setFillColor(NAVY)
c.setFont('Sans-Bold', 7)
c.drawCentredString(bx + 17.5*mm, by + 14*mm, 'REPORTING WEEK')
c.setFont('Sans-Bold', 11)
c.drawCentredString(bx + 17.5*mm, by + 6*mm, week_str)
y -= BH + 6*mm

# ── KPI STRIP ───────────────────────────────────────────────────
KH = 26*mm
KW = (W - 2*M - 9*mm) / 4
delays_count = len(delays_log)
safety_obs = safety.get('observations', 0)

kpis = [
    ('Days Remaining', str(days_remaining), None, OEM),
    ('Active Team', str(active_team), None, NAVY),
    ('Delays This Week', str(delays_count),
     'No delays logged' if delays_count == 0 else None, GREEN if delays_count == 0 else AMBER),
    ('Safety Observations', str(safety_obs),
     'Zero incidents' if safety.get('incidents', 0) == 0 else None,
     GREEN if safety.get('incidents', 0) == 0 else AMBER),
]
for i, (lbl, val, sub, col) in enumerate(kpis):
    kpi_card(c, M + i*(KW + 3*mm), y - KH, KW, KH, lbl, val, sub, col)
y -= KH + 5*mm

# ── PROGRESS BAR ────────────────────────────────────────────────
pct_display = min(max(progress_pct, 0), 100)
c.setFillColor(MUTED); c.setFont('Sans', 7.5)
c.drawString(M, y, 'Project Progress')
c.drawRightString(W - M, y, f'{pct_display:.1f}% complete')
y -= 4*mm
c.setFillColor(BORDER)
c.roundRect(M, y - 3*mm, W - 2*M, 3*mm, 1.5*mm, fill=1, stroke=0)
c.setFillColor(OEM)
bar_w = max((W - 2*M) * (pct_display / 100.0), 0.5*mm)
c.roundRect(M, y - 3*mm, bar_w, 3*mm, 1.5*mm, fill=1, stroke=0)
y -= 11*mm

# ── COMPLETED TASKS ─────────────────────────────────────────────
y = section_heading(c, y, 'Completed Tasks This Week')
y -= 1*mm

CW = [103*mm, 30*mm, 22*mm]
c.setFillColor(HexColor('#F3F4F6'))
c.rect(M, y - 7*mm, W - 2*M, 7*mm, fill=1, stroke=0)
c.setFillColor(MUTED); c.setFont('Sans-Bold', 7.5)
xi = M
for hdr, cw in zip(['Task Description', 'Status', 'Complete'], CW):
    c.drawString(xi + 2*mm, y - 4.5*mm, hdr); xi += cw
y -= 7*mm

for i, task in enumerate(completed_tasks):
    desc = str(task.get('description', ''))
    pct_val = task.get('percentComplete', 100)
    pct_str = f"{pct_val}%" if pct_val is not None else '100%'
    status_str = 'Complete' if (pct_val is None or int(pct_val) >= 100) else 'In Progress'
    if i % 2 == 0:
        c.setFillColor(HexColor('#F9FAFB'))
        c.rect(M, y - 7*mm, W - 2*M, 7*mm, fill=1, stroke=0)
    c.setFillColor(TEXT); c.setFont('Sans', 8)
    # Truncate task description to fit column
    trunc = desc
    max_tw = CW[0] - 5*mm
    while trunc and c.stringWidth(trunc, 'Sans', 8) > max_tw:
        trunc = trunc[:-2] + '\\u2026'
    c.drawString(M + 2*mm, y - 4.8*mm, trunc)
    sc = GREEN if status_str == 'Complete' else AMBER
    pill(c, M + CW[0] + 1*mm, y - 5.5*mm, status_str, sc)
    c.setFillColor(TEXT); c.setFont('Sans', 8)
    c.drawString(M + CW[0] + CW[1] + 2*mm, y - 4.8*mm, pct_str)
    h_line(c, y - 7*mm)
    y -= 7*mm
    # Prevent overflow into footer
    if y < 20*mm:
        break
y -= 5*mm

# ── DELAYS LOG ──────────────────────────────────────────────────
if y > 30*mm:
    y = section_heading(c, y, 'Delays Log')
    if not delays_log:
        c.setFillColor(HexColor('#F0FDF4'))
        c.roundRect(M, y - 11*mm, W - 2*M, 11*mm, 2*mm, fill=1, stroke=0)
        c.setFillColor(GREEN); c.setFont('Sans-Bold', 9)
        c.drawString(M + 4*mm, y - 5*mm, 'No delays have been logged this week.')
        c.setFillColor(MUTED); c.setFont('Sans', 8)
        c.drawString(M + 4*mm, y - 9.5*mm, f'Project remains on schedule as of {fmt_date(D.get("weekEnd",""))}.')
        y -= 17*mm
    else:
        CWD = [90*mm, 30*mm, 35*mm]
        c.setFillColor(HexColor('#F3F4F6'))
        c.rect(M, y - 7*mm, W - 2*M, 7*mm, fill=1, stroke=0)
        c.setFillColor(MUTED); c.setFont('Sans-Bold', 7.5)
        xi = M
        for hdr, cw in zip(['Description', 'Duration', 'Agreed w/ Customer'], CWD):
            c.drawString(xi + 2*mm, y - 4.5*mm, hdr); xi += cw
        y -= 7*mm
        for i, d in enumerate(delays_log):
            if i % 2 == 0:
                c.setFillColor(HexColor('#F9FAFB'))
                c.rect(M, y - 7*mm, W - 2*M, 7*mm, fill=1, stroke=0)
            c.setFillColor(TEXT); c.setFont('Sans', 8)
            desc_d = str(d.get('description', ''))
            trunc_d = desc_d
            while trunc_d and c.stringWidth(trunc_d, 'Sans', 8) > CWD[0] - 5*mm:
                trunc_d = trunc_d[:-2] + '\\u2026'
            c.drawString(M + 2*mm, y - 4.8*mm, trunc_d)
            c.setFillColor(MUTED)
            c.drawString(M + CWD[0] + 2*mm, y - 4.8*mm, str(d.get('duration', '') or ''))
            agreed = str(d.get('agreedWithCustomer', '') or '')
            pill_col = GREEN if agreed.lower() in ('yes', 'true', '1') else AMBER
            pill(c, M + CWD[0] + CWD[1] + 1*mm, y - 5.5*mm, agreed or 'Pending', pill_col)
            h_line(c, y - 7*mm)
            y -= 7*mm
            if y < 20*mm: break
        y -= 5*mm

# ── COMMENTS & CONCERNS ─────────────────────────────────────────
if y > 30*mm:
    y = section_heading(c, y, 'Comments & Concerns Log')
    y -= 2*mm
    for entry in comments_entries:
        if y < 25*mm:
            break
        date_lbl = entry.get('date', '')
        text_lbl = entry.get('entry', '')
        c.setFillColor(OEM)
        c.roundRect(M, y - 5*mm, 16*mm, 5*mm, 1.5*mm, fill=1, stroke=0)
        c.setFillColor(WHITE); c.setFont('Sans-Bold', 7.5)
        c.drawCentredString(M + 8*mm, y - 3.5*mm, str(date_lbl)[:10])
        c.setFillColor(TEXT)
        end_y = wrap_text(c, text_lbl, M + 20*mm, y - 1.5*mm, W - 2*M - 22*mm, size=8.5)
        h_line(c, end_y - 2*mm, color=HexColor('#E5E7EB'))
        y = end_y - 6*mm

# ══════════════════════════════════════════════════════════════════
# PAGE 2
# ══════════════════════════════════════════════════════════════════
c.showPage()
draw_header(c, 2)
draw_footer(c)
y = H - 22*mm - 8*mm

# ── WORKFORCE DEPLOYMENT ────────────────────────────────────────
y = section_heading(c, y, 'Workforce Deployment')
y -= 2*mm

day_c = sum(1 for t in team_members if str(t.get('shift','')).lower() == 'day')
night_c = sum(1 for t in team_members if str(t.get('shift','')).lower() == 'night')
c.setFillColor(MUTED); c.setFont('Sans', 8)
c.drawString(M, y, f'{len(team_members)} personnel assigned  |  {day_c} Day shift  |  {night_c} Night shift')
y -= 6*mm

CW2 = [70*mm, 30*mm, 20*mm, 27*mm, 27*mm]
c.setFillColor(HexColor('#F3F4F6'))
c.rect(M, y - 7*mm, W - 2*M, 7*mm, fill=1, stroke=0)
c.setFillColor(MUTED); c.setFont('Sans-Bold', 7.5)
xi = M
for hdr, cw in zip(['Name', 'Role', 'Shift', 'Start Date', 'End Date'], CW2):
    c.drawString(xi + 2*mm, y - 4.5*mm, hdr); xi += cw
y -= 7*mm

for i, member in enumerate(team_members):
    if y < 20*mm:
        # Overflow to new page
        c.showPage()
        draw_header(c, 3)
        draw_footer(c)
        y = H - 22*mm - 8*mm
    name = str(member.get('name', ''))
    role = str(member.get('role', ''))
    shift = str(member.get('shift', ''))
    start = fmt_date(member.get('startDate', ''))
    end = fmt_date(member.get('endDate', ''))
    if i % 2 == 0:
        c.setFillColor(HexColor('#F9FAFB'))
        c.rect(M, y - 7*mm, W - 2*M, 7*mm, fill=1, stroke=0)
    xi = M
    c.setFillColor(TEXT); c.setFont('Sans', 8)
    # Truncate name if needed
    trunc_name = name
    while trunc_name and c.stringWidth(trunc_name, 'Sans', 8) > CW2[0] - 5*mm:
        trunc_name = trunc_name[:-2] + '\\u2026'
    c.drawString(xi + 2*mm, y - 4.8*mm, trunc_name); xi += CW2[0]
    c.setFillColor(MUTED); c.drawString(xi + 2*mm, y - 4.8*mm, role); xi += CW2[1]
    shift_col = OEM if shift.lower() == 'day' else NAVY
    pill(c, xi + 1*mm, y - 5.5*mm, shift, shift_col); xi += CW2[2]
    c.setFillColor(TEXT); c.drawString(xi + 2*mm, y - 4.8*mm, start); xi += CW2[3]
    c.drawString(xi + 2*mm, y - 4.8*mm, end)
    h_line(c, y - 7*mm)
    y -= 7*mm

h_line(c, y + 7*mm, color=OEM, width=0.8)
y -= 10*mm

# ── WORK PACKAGES (L/S only) ────────────────────────────────────
if is_ls and work_packages and y > 40*mm:
    y = section_heading(c, y, 'Work Package Milestones')
    y -= 2*mm
    CW3 = [75*mm, 27*mm, 27*mm, 27*mm, 27*mm]
    c.setFillColor(HexColor('#F3F4F6'))
    c.rect(M, y - 7*mm, W - 2*M, 7*mm, fill=1, stroke=0)
    c.setFillColor(MUTED); c.setFont('Sans-Bold', 7.5)
    xi = M
    for hdr, cw in zip(['Work Package', 'Plan Start', 'Plan Finish', 'Act. Start', 'Act. Finish'], CW3):
        c.drawString(xi + 2*mm, y - 4.5*mm, hdr); xi += cw
    y -= 7*mm
    for i, wp in enumerate(work_packages):
        if y < 20*mm: break
        if i % 2 == 0:
            c.setFillColor(HexColor('#F9FAFB'))
            c.rect(M, y - 7*mm, W - 2*M, 7*mm, fill=1, stroke=0)
        xi = M
        wp_name = str(wp.get('name', ''))
        trunc_wp = wp_name
        while trunc_wp and c.stringWidth(trunc_wp, 'Sans', 8) > CW3[0] - 5*mm:
            trunc_wp = trunc_wp[:-2] + '\\u2026'
        c.setFillColor(TEXT); c.setFont('Sans', 8)
        c.drawString(xi + 2*mm, y - 4.8*mm, trunc_wp); xi += CW3[0]
        for date_key in ('plannedStart', 'plannedFinish', 'actualStart', 'actualFinish'):
            val = fmt_date(wp.get(date_key, '')) or '—'
            c.setFillColor(MUTED if '—' in val else TEXT)
            c.drawString(xi + 2*mm, y - 4.8*mm, val); xi += CW3[1]
        h_line(c, y - 7*mm)
        y -= 7*mm
    y -= 5*mm

# ── HEALTH & SAFETY ─────────────────────────────────────────────
if y < 80*mm:
    c.showPage()
    draw_header(c, 3)
    draw_footer(c)
    y = H - 22*mm - 8*mm

y = section_heading(c, y, 'Health & Safety Summary')
y -= 2*mm
c.setFillColor(MUTED); c.setFont('Sans', 8)
c.drawString(M, y, f'Reporting period: {fmt_date(D.get("weekStart",""))} \\u2013 {fmt_date(D.get("weekEnd",""))}')
y -= 7*mm

KW2 = (W - 2*M - 9*mm) / 4
safety_kpis = [
    ('Toolbox Talks',       str(safety.get('toolboxTalks', 0)), None, NAVY),
    ('Safety Observations', str(safety.get('observations', 0)), None, GREEN),
    ('Near Misses',         str(safety.get('nearMisses', 0)),   None, GREEN),
    ('Incidents / LTIs',    str(safety.get('incidents', 0)),    None, GREEN),
]
KH2 = 22*mm
for i, (lbl, val, sub, col) in enumerate(safety_kpis):
    kpi_card(c, M + i*(KW2 + 3*mm), y - KH2, KW2, KH2, lbl, val, sub, col)
y -= KH2 + 5*mm

inc_count = safety.get('incidents', 0)
c.setFillColor(HexColor('#F0FDF4'))
c.roundRect(M, y - 11*mm, W - 2*M, 11*mm, 2*mm, fill=1, stroke=0)
c.setFillColor(GREEN if inc_count == 0 else AMBER)
c.setFont('Sans-Bold', 9)
msg = 'Zero incidents this week. Excellent safety performance.' if inc_count == 0 else f'{inc_count} incident(s) reported this week.'
c.drawString(M + 4*mm, y - 6*mm, msg)
c.setFillColor(MUTED); c.setFont('Sans', 8)
c.drawString(M + 4*mm, y - 10*mm, f'Reporting period: {fmt_date(D.get("weekStart",""))} \\u2013 {fmt_date(D.get("weekEnd",""))}')
y -= 17*mm

# ── SIGN-OFF ─────────────────────────────────────────────────────
y -= 5*mm
if y < 40*mm:
    c.showPage()
    draw_header(c, 3)
    draw_footer(c)
    y = H - 22*mm - 8*mm
    y -= 5*mm

c.setFillColor(HexColor('#F8FAFC'))
c.roundRect(M, y - 24*mm, W - 2*M, 24*mm, 2*mm, fill=1, stroke=0)
h_line(c, y, color=OEM, width=1)
c.setFillColor(TEXT); c.setFont('Sans-Bold', 9)
pm_label = f'Report prepared by {pm_name}'
c.drawString(M + 5*mm, y - 7*mm, pm_label)
next_monday_str = ''
try:
    from datetime import datetime, timedelta
    we = datetime.strptime(D.get('weekEnd','')[:10], '%Y-%m-%d')
    next_mon = we + timedelta(days=8)
    next_monday_str = next_mon.strftime('%d %B %Y')
except Exception:
    pass
c.setFillColor(MUTED); c.setFont('Sans', 8)
if next_monday_str:
    c.drawString(M + 5*mm, y - 13*mm, f'Next report: Monday {next_monday_str}.')
c.setFillColor(OEM); c.setFont('Sans', 8)
portal_url = f'{APP_URL}/#/portal/{project_code}'
c.drawString(M + 5*mm, y - 19*mm, f'Live project portal: {portal_url}')

c.save()
print(f'OK:{${JSON.stringify(outputPdf)}}')
`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function generateWeeklyReportPdf(data: ReportData): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const stamp = `pfg-report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputJsonPath = path.join(tmpDir, `${stamp}.json`);
  const outputPdfPath = path.join(tmpDir, `${stamp}.pdf`);
  const scriptPath    = path.join(tmpDir, `${stamp}.py`);

  try {
    // 1. Write JSON data
    fs.writeFileSync(inputJsonPath, JSON.stringify(data), 'utf8');

    // 2. Write Python script
    const script = buildPythonScript(inputJsonPath, outputPdfPath);
    fs.writeFileSync(scriptPath, script, 'utf8');

    // 3. Execute python3
    const { stdout, stderr } = await execFileAsync('python3', [scriptPath], {
      timeout: 60_000,
    });

    if (stderr && stderr.trim()) {
      console.warn('[report-generator] Python stderr:', stderr.trim());
    }

    if (!fs.existsSync(outputPdfPath)) {
      throw new Error(`[report-generator] PDF not created. stdout: ${stdout}  stderr: ${stderr}`);
    }

    // 4. Read PDF into Buffer
    const pdfBuffer = fs.readFileSync(outputPdfPath);
    return pdfBuffer;

  } finally {
    // 5. Clean up temp files
    for (const f of [inputJsonPath, outputPdfPath, scriptPath]) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
}
