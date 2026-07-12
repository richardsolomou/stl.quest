import { queryOptions } from '@tanstack/react-query'
import { getBoardSettings, getStorageSettings, getTelemetrySettings, listRequests, listPeople, listUsers, sessionInfo } from '../server/fns'

export const sessionQuery = () => queryOptions({ queryKey: ['session'], queryFn: () => sessionInfo() })
export const requestsQuery = () => queryOptions({ queryKey: ['requests'], queryFn: () => listRequests() })
export const peopleQuery = () => queryOptions({ queryKey: ['people'], queryFn: () => listPeople() })
export const usersQuery = () => queryOptions({ queryKey: ['users'], queryFn: () => listUsers() })
export const storageQuery = () => queryOptions({ queryKey: ['storage'], queryFn: () => getStorageSettings() })
export const telemetryQuery = () => queryOptions({ queryKey: ['telemetry'], queryFn: () => getTelemetrySettings() })
export const boardQuery = () => queryOptions({ queryKey: ['board-settings'], queryFn: () => getBoardSettings() })
