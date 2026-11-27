import sys, json, asyncio
from playwright.async_api import async_playwright
out = sys.argv[1]; import os; data = open(os.environ.get('DATA','/home/claude/harness/sample.json')).read()
VIEWS = ['tasks','active','agenda','archive']
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width':1280,'height':800})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
        await pg.add_init_script(f"""(() => {{ if (!sessionStorage.getItem('seeded')) {{ localStorage.clear(); localStorage.setItem('bitacora_tracker_v1', {json.dumps(data)}); sessionStorage.setItem('seeded','1'); }} }})()""")
        await pg.clock.set_fixed_time('2026-11-26T10:00:00') if hasattr(pg,'clock') else None
        for v in VIEWS:
            await pg.evaluate(f"localStorage.setItem('bt_vista','{v}')") if v!='tasks' else None
            await pg.goto('http://localhost:1420/'); await pg.wait_for_timeout(1200)
            await pg.screenshot(path=f'{out}/{v}.png', full_page=False)
        # project editor: click first project row on Proyectos
        await pg.evaluate("localStorage.setItem('bt_vista','active')"); await pg.goto('http://localhost:1420/'); await pg.wait_for_timeout(1000)
        rows = await pg.query_selector_all('.prow3 .c-name')
        if rows:
            await pg.get_by_text(os.environ.get('PROJ','CONDOMINIO VISTA DEL BOSQUE')).first.click(); await pg.wait_for_timeout(800); await pg.screenshot(path=f'{out}/editor.png')
            tl = pg.get_by_role('tab', name='Línea de tiempo')
            if await tl.count(): await tl.click(); await pg.wait_for_timeout(500); await pg.screenshot(path=f'{out}/timeline.png')
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
        for label, fname in [('Informe','informe'),('Nueva','nueva')]:
            btn = pg.get_by_role('button', name=label).first
            if await btn.count():
                await btn.click(); await pg.wait_for_timeout(700); await pg.screenshot(path=f'{out}/{fname}.png'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
        # settings panel
        fab = await pg.query_selector('.settings-fab')
        if fab:
            await fab.click(); await pg.wait_for_timeout(600); await pg.screenshot(path=f'{out}/settings.png'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
            if await pg.query_selector('.settings-panel.open, .settings.open'): await fab.click()
        # second project: notes tab and timeline
        p2 = os.environ.get('PROJ2')
        if p2:
            await pg.goto('http://localhost:1420/'); await pg.wait_for_timeout(900)
            await pg.get_by_text(p2).first.click(); await pg.wait_for_timeout(700)
            for tab, fn in [('Línea de tiempo','timeline2'),('Notas','notes2'),('Ubicación','ubicacion2')]:
                t = pg.get_by_role('tab', name=tab)
                if await t.count(): await t.click(); await pg.wait_for_timeout(500); await pg.screenshot(path=f'{out}/{fn}.png')
            await pg.keyboard.press('Escape')
        await pg.set_viewport_size({'width':900,'height':800}); await pg.evaluate("localStorage.setItem('bt_vista','tasks')"); await pg.goto('http://localhost:1420/'); await pg.wait_for_timeout(1000); await pg.screenshot(path=f'{out}/narrow.png')
        print('rows', len(rows)); print('ERRORS', errs[:10])
        await b.close()
asyncio.run(main())
