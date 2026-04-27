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

// ─────────────────────────────────────────────────────────────────────────────
// Playwright HTML-to-PDF weekly report (replaces Python/ReportLab)
// ─────────────────────────────────────────────────────────────────────────────

import { renderHtmlToPdf, logoBase64 } from "./html-pdf";

export async function generateWeeklyReportPdfHtml(data: ReportData): Promise<Buffer> {
  const tmpPath = path.join(os.tmpdir(), `pfg-report-${Date.now()}.pdf`);
  const logoB64 = logoBase64("logo-gold");
  const oem = data.oemColour || "#005E60";

  function sd(d: string): string {
    if (!d) return "";
    const months = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const p = d.split("-");
    return p.length === 3 ? `${parseInt(p[2])} ${months[parseInt(p[1])]}` : d;
  }

  function th(h: string, w = ""): string {
    return `<th style="font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;padding:7px 12px;text-align:left;border-bottom:1px solid #E5E7EB;background:#F9FAFB${w ? ";width:"+w : ""}">${h}</th>`;
  }

  function tbl(headers: [string,string][], rows: string): string {
    const ths = headers.map(([h,w]) => th(h,w)).join("");
    return `<table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:6px;overflow:hidden"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function stitle(title: string, meta = ""): string {
    const m = meta ? `<span style="font-size:11px;color:#9CA3AF">${meta}</span>` : "";
    return `<div style="margin:20px 0 8px;padding-bottom:6px;border-bottom:1px solid #E5E7EB;display:flex;align-items:baseline;justify-content:space-between"><span style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#374151">${title}</span>${m}</div>`;
  }

  function kpi(label: string, value: string, sub: string, accent: string): string {
    return `<div style="border:1px solid #E5E7EB;border-radius:6px;padding:10px 14px;border-top:2px solid ${accent}"><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;margin-bottom:4px;white-space:nowrap">${label}</div><div style="font-size:17px;font-weight:700;color:${accent};line-height:1">${value}</div><div style="font-size:11px;color:#9CA3AF;margin-top:3px">${sub}</div></div>`;
  }

  // HTML escape for free-text fields rendered inside table cells, so quotes/angle
  // brackets/ampersands don't break layout or get swallowed silently.
  function esc(s: string): string {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Safety obs rows — allow long descriptions to wrap fully across multiple
  // lines instead of truncating at 100 chars (PDF was cutting mid-sentence).
  const obsRows = (data as any).safetyObservations?.map((o: any, i: number) => {
    const typeMap: Record<string,string> = {positive:"Positive",unsafe_condition:"Unsafe",negative:"Negative",stop_work:"Stop Work"};
    const colorMap: Record<string,string> = {positive:"#15803D",unsafe_condition:"#B45309",negative:"#DC2626",stop_work:"#DC2626"};
    const t = o.observationType || "";
    const lbl = typeMap[t] || t;
    const tc = colorMap[t] || "#374151";
    const bg = i%2===0 ? "#F9FAFB" : "#fff";
    const desc = esc(o.description || "");
    return `<tr style="background:${bg}"><td style="color:#6B7280;font-size:12px;white-space:nowrap;vertical-align:top">${sd(o.observationDate||"")}</td><td style="color:${tc};font-weight:600;font-size:12px;vertical-align:top">${lbl}</td><td style="color:#6B7280;font-size:12px;vertical-align:top">${esc(o.locationOnSite||"")}</td><td style="font-size:12px;vertical-align:top;word-break:break-word;overflow-wrap:break-word;white-space:normal;line-height:1.45">${desc}</td></tr>`;
  }).join("") || "";

  // TBT rows
  const tbtRows = (data as any).toolboxTalks?.map((t: any, i: number) => {
    const bg = i%2===0 ? "#F9FAFB" : "#fff";
    return `<tr style="background:${bg}"><td style="color:#6B7280;font-size:12px;white-space:nowrap;vertical-align:top">${sd(t.reportDate||"")}</td><td style="font-size:12px;vertical-align:top">${esc(t.topic||"")}</td><td style="text-align:right;color:#6B7280;font-size:12px;vertical-align:top">${esc(String(t.attendeeCount||""))}</td></tr>`;
  }).join("") || "";

  // Delays rows
  const delaysRows = data.delaysLog.map((d, i) => {
    const bg = i%2===0 ? "#F9FAFB" : "#fff";
    const resp = (d as any).responsibility || "";
    const dur = d.duration ? `${d.duration}${(d as any).durationUnit||"h"}` : "";
    return `<tr style="background:${bg}"><td style="color:#6B7280;font-size:12px;white-space:nowrap;vertical-align:top">${sd((d as any).date||"")} &middot; ${esc(dur)}</td><td style="color:#6B7280;font-size:12px;vertical-align:top">${esc(resp)}</td><td style="font-size:12px;vertical-align:top">${esc(d.description||"")}</td></tr>`;
  }).join("");

  // Comments
  const commentsHtml = data.commentsEntries.map(c => {
    const paras = c.entry.split("\n").filter((p: string) => p.trim()).map((p: string) => `<p style="margin:0 0 5px 0">${esc(p)}</p>`).join("");
    return `<div style="padding:12px 0;border-bottom:1px solid #F3F4F6;display:grid;grid-template-columns:44px 1fr;gap:14px"><div style="font-size:10px;font-weight:700;color:#005E60;text-transform:uppercase;padding-top:2px">${sd(c.date)}</div><div style="font-size:12px;color:#374151;line-height:1.55">${paras}</div></div>`;
  }).join("");

  // Team rows
  const teamRows = data.teamMembers.map((m, i) => {
    const bg = i%2===0 ? "#F9FAFB" : "#fff";
    return `<tr style="background:${bg}"><td style="font-weight:500;font-size:12px;vertical-align:top">${esc(m.name)}</td><td style="color:#6B7280;font-size:12px;vertical-align:top">${esc(m.role)}</td><td style="color:#6B7280;font-size:12px;vertical-align:top">${esc(m.shift)}</td><td style="color:#6B7280;font-size:12px;white-space:nowrap;vertical-align:top">${sd(m.startDate)}</td><td style="color:#6B7280;font-size:12px;white-space:nowrap;vertical-align:top">${sd(m.endDate)}</td></tr>`;
  }).join("");

  const nObs = (data as any).safetyObservations?.length || data.safetyData.observations;
  const nTbts = (data as any).toolboxTalks?.length || data.safetyData.toolboxTalks;
  const nDelays = data.delaysLog.length;
  const nComments = data.commentsEntries.length;
  const nTeam = data.teamMembers.length;
  const pct = data.progressPct;
  const nRem = data.daysRemaining;
  const obsPos = (data as any).safetyObservations?.filter((o: any) => o.observationType==="positive").length || 0;
  const obsUnsafe = (data as any).safetyObservations?.filter((o: any) => o.observationType==="unsafe_condition").length || 0;
  const obsNeg = (data as any).safetyObservations?.filter((o: any) => o.observationType==="negative").length || 0;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Weekly Report</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:#fff;color:#1F2937;font-size:12.5px;-webkit-font-smoothing:antialiased;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.wrap{max-width:720px;margin:0 auto;padding:32px 40px}
td{padding:8px 12px;border-bottom:1px solid #F3F4F6;vertical-align:top;word-break:break-word;overflow-wrap:break-word}
table{table-layout:fixed;width:100%}
tr{page-break-inside:auto;break-inside:auto}
@media print{@page{size:A4;margin:14mm 16mm}body{font-size:11.5px}.wrap{padding:0;max-width:none}tr{page-break-inside:auto;break-inside:auto}}
</style>
</head>
<body>
<div class="wrap">
  <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:2px solid #1a2744;margin-bottom:16px">
    <img src="${logoB64}" style="height:22px;width:auto"/>
    <div style="text-align:right;font-size:11px;color:#9CA3AF">Weekly Report &nbsp;&middot;&nbsp; w/c ${sd(data.weekStart)} &nbsp;&middot;&nbsp; Confidential</div>
  </div>

  <div style="margin-bottom:14px">
    <div style="font-size:11px;color:#9CA3AF;margin-bottom:3px">${data.customer} &middot; ${data.projectCode} &middot; ${data.siteName}</div>
    <div style="display:flex;gap:24px;font-size:12px;color:#6B7280;flex-wrap:wrap">
      <span>Period &nbsp;<strong style="color:#374151">${sd(data.startDate)} &rarr; ${sd(data.endDate)}</strong></span>
      <span>PM &nbsp;<strong style="color:#374151">${data.pmName}</strong></span>
      <span>Contract &nbsp;<strong style="color:#374151">${data.contractType||"T&M"}</strong></span>
    </div>
  </div>

  <div style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#6B7280">Project Progress</div>
      <div style="font-size:12px;font-weight:700;color:#1a2744">${data.daysRemaining !== undefined ? (126-data.daysRemaining) : 0} of 126 days &nbsp;&middot;&nbsp; ${pct}% complete</div>
    </div>
    <div style="height:4px;background:#E5E7EB;border-radius:2px"><div style="height:100%;width:${pct}%;background:#005E60;border-radius:2px"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#9CA3AF;margin-top:3px"><span>Mobilisation</span><span>Outage Execution</span><span>Demob</span></div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px">
    ${kpi("Days Remaining", String(nRem), "remaining calendar days", "#1a2744")}
    ${kpi("Team on Site", String(nTeam), "active personnel this week", "#1a2744")}
    ${kpi("Incidents / LTIs", String(data.safetyData.incidents), "zero lost-time injuries", data.safetyData.incidents>0 ? "#DC2626" : "#15803D")}
    ${kpi("Safety Obs.", String(nObs), `${obsPos} pos &middot; ${obsUnsafe} unsafe &middot; ${obsNeg} neg`, obsUnsafe>0 ? "#D97706" : "#15803D")}
    ${kpi("Delays (this week)", String(nDelays), "external, agreed w/ customer", nDelays>0 ? "#D97706" : "#15803D")}
    ${kpi("Toolbox Talks", String(nTbts), "pre-shift briefings this week", "#1a2744")}
  </div>

  ${stitle("Safety Observations", `Week of ${sd(data.weekStart)}&ndash;${sd(data.weekEnd)}`)}
  ${obsRows ? tbl([["Date","60px"],["Type","110px"],["Location","100px"],["Observation",""]], obsRows) : '<p style="font-size:12px;color:#9CA3AF;padding:8px 0">No safety observations recorded.</p>'}

  ${stitle("Toolbox Talks", nTbts+" this week")}
  ${tbtRows ? tbl([["Date","60px"],["Topic",""],["Attendees","70px"]], tbtRows) : '<p style="font-size:12px;color:#9CA3AF;padding:8px 0">No toolbox talks recorded.</p>'}

  ${stitle("Comments &amp; Concerns", nComments+" entries this week")}
  <div style="border:1px solid #E5E7EB;border-radius:6px;padding:0 14px">
    ${commentsHtml || '<div style="padding:14px 0;color:#9CA3AF;font-size:12px">No comments logged this week.</div>'}
  </div>

  ${stitle("Delays Log (this week)", nDelays+" entr"+(nDelays===1?"y":"ies")+" &middot; external, agreed with customer")}
  ${delaysRows ? tbl([["Date &middot; Duration","110px"],["Responsibility","100px"],["Description",""]], delaysRows) : '<p style="font-size:12px;color:#9CA3AF;padding:8px 0">No delays recorded this week.</p>'}

  ${stitle("Personnel on Site", nTeam+" workers")}
  ${teamRows ? tbl([["Name",""],["Role","130px"],["Shift","70px"],["Start","95px"],["End","95px"]], teamRows) : '<p style="font-size:12px;color:#9CA3AF;padding:8px 0">No team data available.</p>'}

  <div style="margin-top:22px;padding-top:12px;border-top:1px solid #E5E7EB;display:flex;justify-content:space-between;font-size:11px;color:#9CA3AF">
    <span><strong style="color:#374151">${data.pmName}</strong> &nbsp;&middot;&nbsp; Project Manager, Powerforce Global</span>
    <span>Generated ${new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})}</span>
  </div>
</div>
</body>
</html>`;

  await renderHtmlToPdf(html, tmpPath);
  const buf = fs.readFileSync(tmpPath);
  try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  return buf;
}
