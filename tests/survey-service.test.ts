import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaelianDatabase } from '@/storage/database';
import {
  SurveyService,
  validateSurveySubmission,
} from '@/surveys/survey-service';
import type { SurveyCatalog, SurveyDefinition } from '@/surveys/types';

const databaseNames: string[] = [];

const survey: SurveyDefinition = {
  id: '2026-08-ui-opinion',
  revision: 1,
  kind: 'survey',
  title: '界面体验调查',
  description: '请告诉我们目前最需要改善的部分。',
  active: true,
  questions: [
    {
      id: 'device',
      type: 'single-choice',
      title: '主要使用哪种设备？',
      required: true,
      options: [
        { value: 'mobile', label: '手机' },
        { value: 'pc', label: '电脑' },
      ],
    },
    {
      id: 'details',
      type: 'long-text',
      title: '具体建议',
      required: false,
      maxLength: 500,
    },
    {
      id: 'ideas',
      type: 'multiple-choice',
      title: '希望添加哪些内容？',
      required: false,
      options: [
        { value: 'letters', label: '互寄信件' },
        {
          value: 'other',
          label: '其他想法',
          freeText: true,
          textMaxLength: 100,
        },
      ],
    },
    {
      id: 'ideas_other_legacy',
      type: 'long-text',
      title: '请填写其他想法',
      required: false,
      maxLength: 100,
      legacyFallbackFor: {
        questionId: 'ideas',
        optionValue: 'other',
      },
    },
  ],
};

const catalog: SurveyCatalog = {
  schemaVersion: 1,
  channel: 'alpha',
  revision: '2026-08-03.1',
  surveys: [survey],
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe('问卷回答校验', () => {
  it('拒绝遗漏必填项和伪造选项', () => {
    expect(
      validateSurveySubmission(survey, {
        answers: { device: 'console' },
        discordId: '',
      }),
    ).toMatchObject({
      valid: false,
      errors: ['“主要使用哪种设备？”包含无效选项。'],
    });
  });

  it('只保留清单内的问题并规范文本与 Discord ID', () => {
    expect(
      validateSurveySubmission(survey, {
        answers: {
          device: 'mobile',
          details: '  希望翻页动画更明显。  ',
          injected: '不应提交',
        },
        discordId: '  player.123  ',
      }),
    ).toEqual({
      valid: true,
      errors: [],
      answers: {
        device: 'mobile',
        details: '希望翻页动画更明显。',
      },
      discordId: 'player.123',
    });
  });

  it('多选题的其他选项必须填写具体内容并会规范空白', () => {
    const interactionSurvey: SurveyDefinition = {
      ...survey,
      id: 'interaction-survey',
      questions: [
        {
          id: 'interactions',
          type: 'multiple-choice',
          title: '希望添加哪些交互？',
          required: true,
          options: [
            { value: 'letters', label: '互寄信件' },
            {
              value: 'other',
              label: '其他想法',
              freeText: true,
              textMaxLength: 100,
            },
          ],
        },
      ],
    };

    expect(
      validateSurveySubmission(interactionSurvey, {
        answers: { interactions: ['other'] },
        discordId: '',
      }).valid,
    ).toBe(false);
    expect(
      validateSurveySubmission(interactionSurvey, {
        answers: { interactions: ['letters', 'other::  新增小游戏  '] },
        discordId: '',
      }),
    ).toMatchObject({
      valid: true,
      answers: {
        interactions: ['letters', 'other::新增小游戏'],
      },
    });
  });
});

describe('问卷清单和一次性提交', () => {
  it('忽略后停止提醒，但仍可从入口填写并锁定答案', async () => {
    const name = `caelian-survey-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const db = new CaelianDatabase('alpha', name);
    await db.open();

    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/managed-content/surveys/alpha.json')) {
          return new Response(JSON.stringify(catalog), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(null, { status: 201 });
      });
    const service = new SurveyService(db, window);

    await expect(service.refreshCatalog()).resolves.toMatchObject({
      revision: catalog.revision,
      active: 1,
    });
    await expect(service.pending()).resolves.toEqual([survey]);

    await service.ignore(survey.id);
    await expect(service.pending()).resolves.toEqual([]);
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        response: expect.objectContaining({ status: 'ignored' }),
      }),
    ]);

    const submitted = await service.submit(survey.id, {
      answers: {
        device: 'pc',
        details: '希望按钮更紧凑。',
      },
      discordId: 'tester',
    });
    expect(submitted).toMatchObject({
      status: 'submitted',
      answers: { device: 'pc', details: '希望按钮更紧凑。' },
      discordId: 'tester',
    });

    const postCall = fetchMock.mock.calls.find(
      ([input]) => String(input).includes('caelian_survey_responses'),
    );
    expect(postCall).toBeDefined();
    const request = postCall?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        apikey: expect.stringMatching(/^sb_publishable_/),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
    });
    expect(Object.keys(payload).sort()).toEqual([
      'answers',
      'discord_id',
      'id',
      'submission_token',
      'survey_id',
      'survey_kind',
      'survey_revision',
    ]);
    expect(payload).not.toHaveProperty('chat');
    expect(payload).not.toHaveProperty('mvu');
    expect(payload).not.toHaveProperty('playerName');
    expect(payload).not.toHaveProperty('userAgent');

    const callsAfterFirstSubmission = fetchMock.mock.calls.length;
    await expect(
      service.submit(survey.id, {
        answers: { device: 'mobile' },
        discordId: 'changed',
      }),
    ).resolves.toMatchObject({
      answers: { device: 'pc', details: '希望按钮更紧凑。' },
      discordId: 'tester',
    });
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirstSubmission);

    db.close();
  });

  it('Beta 不再发放或接收问卷，但保留已提交答案', async () => {
    const name = `caelian-beta-survey-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const db = new CaelianDatabase('beta', name);
    await db.open();

    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const service = new SurveyService(db, window, 'beta', [
      'https://example.test/managed-content/surveys/alpha.json',
    ]);

    await expect(service.refreshCatalog()).resolves.toMatchObject({ active: 0 });
    await expect(service.pending()).resolves.toEqual([]);
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ acceptingResponses: false }),
    ]);
    await expect(
      service.submit(survey.id, {
        answers: { device: 'mobile' },
        discordId: '',
      }),
    ).rejects.toThrow('这份问卷已过期');
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('caelian_survey_responses'),
      ),
    ).toHaveLength(0);

    const submittedAt = Date.now();
    await db.surveyResponses.put({
      id: `survey:${survey.id}`,
      surveyId: survey.id,
      surveyRevision: survey.revision,
      status: 'submitted',
      definition: survey,
      answers: { device: 'pc' },
      discordId: 'existing-player',
      submissionId: crypto.randomUUID(),
      submittedAt,
      updatedAt: submittedAt,
    });
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        acceptingResponses: false,
        response: expect.objectContaining({
          status: 'submitted',
          answers: { device: 'pc' },
        }),
      }),
    ]);
    db.close();
  });
});

describe('问卷过期界面', () => {
  it('优先显示已过期并使用只读状态', () => {
    const app = readFileSync(
      path.join(process.cwd(), 'src', 'modules', 'surveys', 'App.vue'),
      'utf8',
    );
    expect(app).toContain("if (!entry.acceptingResponses) return '已过期'");
    expect(app).toContain('v-else-if="expired"');
    expect(app).toContain('这份问卷不再接受回答');
  });
});
