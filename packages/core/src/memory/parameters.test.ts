import { default_w, generatorParameters } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { PARAMETER_COUNT } from './formulas'
import { createFsrsScheduler } from './fsrs-scheduler'
import {
  assertSchedulingOptions,
  DEFAULT_FSRS_PARAMETERS,
  DEFAULT_FSRS_W,
  DEFAULT_SCHEDULING_OPTIONS,
  isStepUnit,
  parametersFromProfile,
  schedulerConfigFromProfile,
  schedulingOptionsFromParameters,
  stepUnitToMinutes,
} from './parameters'

describe('defaults', () => {
  it('are the spec’s 21 parameters and ts-fsrs 5.4.2’s default_w', () => {
    expect(DEFAULT_FSRS_W).toHaveLength(PARAMETER_COUNT)
    expect([...DEFAULT_FSRS_W]).toEqual([...default_w])
    expect(DEFAULT_FSRS_W[20]).toBe(0.1542)
  })

  it('carry the spec’s request retention, cap, steps, fuzz and short-term flags', () => {
    expect(DEFAULT_FSRS_PARAMETERS).toEqual({
      w: DEFAULT_FSRS_W,
      requestRetention: 0.9,
      maximumInterval: 36500,
      learningSteps: ['1m', '10m'],
      relearningSteps: ['10m'],
      enableFuzz: true,
      enableShortTerm: true,
    })
    // Same as ts-fsrs except fuzz, which the spec turns on.
    const generated = generatorParameters()
    expect(generated.request_retention).toBe(DEFAULT_FSRS_PARAMETERS.requestRetention)
    expect(generated.maximum_interval).toBe(DEFAULT_FSRS_PARAMETERS.maximumInterval)
    expect([...generated.learning_steps]).toEqual([...DEFAULT_FSRS_PARAMETERS.learningSteps])
    expect([...generated.relearning_steps]).toEqual([...DEFAULT_FSRS_PARAMETERS.relearningSteps])
    expect(generated.enable_short_term).toBe(true)
    expect(generated.enable_fuzz).toBe(false)
    expect(DEFAULT_SCHEDULING_OPTIONS).toEqual({
      desiredRetention: 0.9,
      maxIntervalDays: 36500,
      learningSteps: ['1m', '10m'],
      relearningSteps: ['10m'],
      fuzz: true,
    })
    expect(Object.isFrozen(DEFAULT_SCHEDULING_OPTIONS)).toBe(true)
  })
})

describe('step units', () => {
  it('recognises ts-fsrs steps and converts them to minutes', () => {
    for (const step of ['1m', '10m', '1h', '1d', '90m']) expect(isStepUnit(step)).toBe(true)
    for (const step of ['', 'm', '10', '10 m', '1w', '-1m', 10, null])
      expect(isStepUnit(step)).toBe(false)
    expect(stepUnitToMinutes('1m')).toBe(1)
    expect(stepUnitToMinutes('90m')).toBe(90)
    expect(stepUnitToMinutes('2h')).toBe(120)
    expect(stepUnitToMinutes('1d')).toBe(1440)
    expect(() => stepUnitToMinutes('1w' as never)).toThrow(RangeError)
  })
})

describe('assertSchedulingOptions', () => {
  it('returns valid options untouched', () => {
    expect(assertSchedulingOptions(DEFAULT_SCHEDULING_OPTIONS)).toBe(DEFAULT_SCHEDULING_OPTIONS)
  })

  it('rejects what ts-fsrs would reject or silently coerce', () => {
    const base = DEFAULT_SCHEDULING_OPTIONS
    expect(() => assertSchedulingOptions({ ...base, desiredRetention: 0 })).toThrow(
      /desiredRetention/,
    )
    expect(() => assertSchedulingOptions({ ...base, desiredRetention: 1.2 })).toThrow(
      /desiredRetention/,
    )
    expect(() => assertSchedulingOptions({ ...base, maxIntervalDays: 0 })).toThrow(
      /maxIntervalDays/,
    )
    expect(() => assertSchedulingOptions({ ...base, maxIntervalDays: 1.5 })).toThrow(
      /maxIntervalDays/,
    )
    expect(() => assertSchedulingOptions({ ...base, learningSteps: ['1w' as never] })).toThrow(
      /learningSteps/,
    )
    expect(() => assertSchedulingOptions({ ...base, relearningSteps: '10m' as never })).toThrow(
      /relearningSteps/,
    )
    expect(() => assertSchedulingOptions({ ...base, fuzz: 'yes' as never })).toThrow(/fuzz/)
  })
})

describe('bridges', () => {
  it('derives options from a parameter set, with overrides', () => {
    expect(schedulingOptionsFromParameters(DEFAULT_FSRS_PARAMETERS)).toEqual(
      DEFAULT_SCHEDULING_OPTIONS,
    )
    expect(
      schedulingOptionsFromParameters(DEFAULT_FSRS_PARAMETERS, { desiredRetention: 0.95 })
        .desiredRetention,
    ).toBe(0.95)
    expect(() =>
      schedulingOptionsFromParameters(DEFAULT_FSRS_PARAMETERS, { desiredRetention: 2 }),
    ).toThrow(RangeError)
  })

  it('reads a stored profile, falling back to the default w when none was optimized', () => {
    const profile = {
      w: [],
      learningSteps: ['2m', '15m'],
      relearningSteps: ['15m'],
      enableFuzz: false,
      enableShortTerm: true,
      maximumInterval: 1825,
      dayStartHour: 4,
    }
    expect(parametersFromProfile(profile)).toEqual({
      w: DEFAULT_FSRS_W,
      requestRetention: 0.9,
      maximumInterval: 1825,
      learningSteps: ['2m', '15m'],
      relearningSteps: ['15m'],
      enableFuzz: false,
      enableShortTerm: true,
    })
    const trained = [...DEFAULT_FSRS_W]
    trained[0] = 0.3
    expect(
      parametersFromProfile({ ...profile, w: trained }, { requestRetention: 0.85 }),
    ).toMatchObject({
      w: trained,
      requestRetention: 0.85,
    })
    expect(() => parametersFromProfile({ ...profile, w: [1, 2] })).toThrow(/21 parameters/)
    expect(() => parametersFromProfile({ ...profile, learningSteps: ['soon'] })).toThrow(
      /learningSteps/,
    )
  })

  it('turns a stored profile into a scheduler config, day-start hour included', () => {
    const profile = { w: [], enableShortTerm: false, dayStartHour: 6 }
    expect(schedulerConfigFromProfile(profile)).toEqual({
      w: DEFAULT_FSRS_W,
      enableShortTerm: false,
      dayStartHour: 6,
    })
    const zoned = schedulerConfigFromProfile(profile, {
      timeZone: 'America/Argentina/Buenos_Aires',
    })
    expect(zoned.timeZone).toBe('America/Argentina/Buenos_Aires')
    const scheduler = createFsrsScheduler(zoned)
    expect(scheduler.dayBoundary).toEqual({
      dayStartHour: 6,
      timeZone: 'America/Argentina/Buenos_Aires',
    })
    expect(scheduler.enableShortTerm).toBe(false)
    const trained = [...DEFAULT_FSRS_W]
    trained[3] = 9
    expect(schedulerConfigFromProfile({ ...profile, w: trained }).w).toEqual(trained)
    expect(() => schedulerConfigFromProfile({ ...profile, w: [1] })).toThrow(/21 parameters/)
  })
})
