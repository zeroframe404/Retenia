import {
  type DiagnosticSectionDto,
  SELF_ASSESSMENT_LEVEL_DTOS,
  type SelfAssessmentLevelDto,
} from '@retenia/ipc-contract'
import { Badge, SegmentedControl } from '@retenia/ui'
import { useT } from '../../../i18n/use-t'

/** What a section starts at before the learner touches it: the middle of the scale. */
export const DEFAULT_SELF_ASSESSMENT_LEVEL: SelfAssessmentLevelDto = 'familiar'

/** The sections the form asks about — every one the preview did not already mark "ya lo sé". */
export function askableSections(sections: readonly DiagnosticSectionDto[]): DiagnosticSectionDto[] {
  return sections.filter((section) => !section.selfDeclared)
}

/**
 * `pathgen.diagnosticStart`'s `selfAssessment`: one level per askable section, keyed by the
 * section's id (the uuid — not its `specId`), the default filled in for the untouched ones.
 * Sections already declared known in the preview are left out: they are never asked.
 */
export function selfAssessmentOf(
  sections: readonly DiagnosticSectionDto[],
  levels: Readonly<Record<string, SelfAssessmentLevelDto>>,
): Record<string, SelfAssessmentLevelDto> {
  return Object.fromEntries(
    askableSections(sections).map((section) => [
      section.id,
      levels[section.id] ?? DEFAULT_SELF_ASSESSMENT_LEVEL,
    ]),
  )
}

export interface SelfAssessmentFormProps {
  sections: readonly DiagnosticSectionDto[]
  levels: Readonly<Record<string, SelfAssessmentLevelDto>>
  onChange: (sectionId: string, level: SelfAssessmentLevelDto) => void
  disabled?: boolean
}

/**
 * §10 step 1's self-assessment, one row per section with the four levels (*never seen it /
 * sounds familiar / I know it / I master it*). A segmented control per row rather than a
 * select: the four levels are the whole decision, and seeing them side by side is what makes
 * "Me suena" and "Lo sé" distinguishable at a glance. Each row is a radiogroup named after its
 * section, so the arrow keys move between levels and a screen reader says which section it is.
 */
export function SelfAssessmentForm({
  sections,
  levels,
  onChange,
  disabled = false,
}: SelfAssessmentFormProps) {
  const t = useT('path')
  const askable = askableSections(sections)
  const declared = sections.filter((section) => section.selfDeclared)
  const options = SELF_ASSESSMENT_LEVEL_DTOS.map((level) => ({
    value: level,
    label: t(`diagnostic.self.level.${level}`),
    disabled,
  }))

  return (
    <div className="flex flex-col gap-6" data-testid="self-assessment-form">
      {askable.length > 0 && (
        <ul className="border-border divide-border flex flex-col divide-y rounded-lg border">
          {askable.map((section) => (
            <li
              key={section.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
              data-testid={`self-assessment-row-${section.specId}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{section.title}</p>
                <p className="text-muted text-xs">
                  {t('diagnostic.self.modules', { count: section.modules.length })}
                </p>
              </div>
              <SegmentedControl
                options={options}
                value={levels[section.id] ?? DEFAULT_SELF_ASSESSMENT_LEVEL}
                onValueChange={(level) => onChange(section.id, level)}
                aria-label={section.title}
              />
            </li>
          ))}
        </ul>
      )}

      {declared.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="self-assessment-declared">
          <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
            {t('diagnostic.self.selfDeclaredHeading')}
          </h2>
          <ul className="flex flex-col gap-2">
            {declared.map((section) => (
              <li
                key={section.id}
                className="flex flex-wrap items-center gap-2 text-sm"
                data-testid={`self-assessment-declared-${section.specId}`}
              >
                <span>{section.title}</span>
                <Badge variant="correct">{t('diagnostic.self.selfDeclared')}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
