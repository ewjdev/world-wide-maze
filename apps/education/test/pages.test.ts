import { baselinePath, learningScript } from '@wwm/learning';
import { describe, expect, it } from 'vitest';
import { homePage, lessonPage, portablePage } from '../src/render.ts';

describe('readable HTML and machine intent', () => {
  it('publishes real page content and data before any client JavaScript', () => {
    const home = homePage(baselinePath);
    for (const activity of baselinePath.activities) {
      expect(home).toContain(`/lessons/${activity.id}/`);
      const html = lessonPage(baselinePath, activity);
      expect(html).toContain(`data-learning-activity="${activity.id}"`);
      expect(html).toContain(activity.objective);
      expect(html).toContain(activity.hint);
      expect(html).toContain(learningScript(baselinePath));
    }
  });
  it('escapes authored strings in visible HTML as well as in JSON', () => {
    const title = '<img src=x onerror=alert(1)>';
    const html = homePage({ ...baselinePath, title });
    expect(html).not.toContain(title);
    expect(html).toContain('&lt;img');
    expect(portablePage({ ...baselinePath, title })).not.toContain(title);
  });
  it('exports a portable document without executable scripts or external resources', () => {
    const html = portablePage(baselinePath);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('type="application/json"');
    expect(html).not.toContain('src=');
    expect(html.match(/data-learning-activity=/g)).toHaveLength(6);
  });
});
