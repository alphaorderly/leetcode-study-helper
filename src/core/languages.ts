import type { LanguageOption } from './types';

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { id: 'cpp', label: 'C++', extension: 'cpp' },
  { id: 'java', label: 'Java', extension: 'java' },
  { id: 'python', label: 'Python', extension: 'py' },
  { id: 'python3', label: 'Python 3', extension: 'py' },
  { id: 'c', label: 'C', extension: 'c' },
  { id: 'csharp', label: 'C#', extension: 'cs' },
  { id: 'javascript', label: 'JavaScript', extension: 'js' },
  { id: 'typescript', label: 'TypeScript', extension: 'ts' },
  { id: 'php', label: 'PHP', extension: 'php' },
  { id: 'swift', label: 'Swift', extension: 'swift' },
  { id: 'kotlin', label: 'Kotlin', extension: 'kt' },
  { id: 'dart', label: 'Dart', extension: 'dart' },
  { id: 'go', label: 'Go', extension: 'go' },
  { id: 'ruby', label: 'Ruby', extension: 'rb' },
  { id: 'scala', label: 'Scala', extension: 'scala' },
  { id: 'rust', label: 'Rust', extension: 'rs' },
  { id: 'racket', label: 'Racket', extension: 'rkt' },
  { id: 'erlang', label: 'Erlang', extension: 'erl' },
  { id: 'elixir', label: 'Elixir', extension: 'ex' },
] as const;

export const DEFAULT_LANGUAGE = 'python3';

export function findLanguage(languageId: string): LanguageOption | undefined {
  return LANGUAGE_OPTIONS.find(({ id }) => id === languageId);
}
