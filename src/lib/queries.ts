import { queryOptions } from '@tanstack/react-query'
import { getAuthSettings, getBoardSettings, getStorageSettings, getTelemetrySettings, listRequests, listPeople, listUsers } from '../server/fns'

export const requestsQuery = () => queryOptions({ queryKey: ['requests'], queryFn: () => listRequests() })
export const peopleQuery = () => queryOptions({ queryKey: ['people'], queryFn: () => listPeople() })
export const usersQuery = () => queryOptions({ queryKey: ['users'], queryFn: () => listUsers() })
export const storageQuery = () => queryOptions({ queryKey: ['storage'], queryFn: () => getStorageSettings() })
export const authQuery = () => queryOptions({ queryKey: ['auth-settings'], queryFn: () => getAuthSettings() })
export const telemetryQuery = () => queryOptions({ queryKey: ['telemetry'], queryFn: () => getTelemetrySettings() })
export const boardQuery = () => queryOptions({ queryKey: ['board-settings'], queryFn: () => getBoardSettings() })
