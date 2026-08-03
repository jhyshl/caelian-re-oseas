export type SurveyKind = 'survey' | 'single';

export type SurveyQuestionType =
  | 'single-choice'
  | 'multiple-choice'
  | 'short-text'
  | 'long-text';

export interface SurveyOption {
  value: string;
  label: string;
}

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  title: string;
  description?: string;
  required: boolean;
  options?: SurveyOption[];
  minSelections?: number;
  maxSelections?: number;
  minLength?: number;
  maxLength?: number;
}

export interface SurveyDefinition {
  id: string;
  revision: number;
  kind: SurveyKind;
  title: string;
  description: string;
  active: boolean;
  startsAt?: string;
  endsAt?: string;
  questions: SurveyQuestion[];
}

export interface SurveyCatalog {
  schemaVersion: 1;
  channel: 'alpha';
  revision: string;
  surveys: SurveyDefinition[];
}

export type SurveyAnswer = string | string[];
export type SurveyAnswers = Record<string, SurveyAnswer>;

export type SurveyResponseStatus = 'ignored' | 'submitted';

export interface SurveyTokenRecord {
  surveyId: string;
  token: string;
  createdAt: number;
}

export interface SurveyResponseRecord {
  id: string;
  surveyId: string;
  surveyRevision: number;
  status: SurveyResponseStatus;
  definition: SurveyDefinition;
  answers: SurveyAnswers;
  discordId: string;
  submissionId?: string;
  serverOnly?: boolean;
  ignoredAt?: number;
  submittedAt?: number;
  updatedAt: number;
}

export interface SurveyListEntry {
  definition: SurveyDefinition;
  response?: SurveyResponseRecord;
  acceptingResponses: boolean;
}

export interface SurveySubmissionDraft {
  answers: SurveyAnswers;
  discordId: string;
}

export interface SurveyValidation {
  valid: boolean;
  errors: string[];
  answers: SurveyAnswers;
  discordId: string;
}

export interface SurveyCatalogSyncResult {
  source: string;
  revision: string;
  changed: boolean;
  active: number;
}
