export const onboardingTaskIds = ['upload', 'move', 'actions', 'sort', 'filter', 'printers', 'storage'] as const

export type OnboardingTaskId = (typeof onboardingTaskIds)[number]
