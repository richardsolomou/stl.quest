import { queryOptions } from '@tanstack/react-query'
import { getStorageSettings, listRequests, listPeople, listUsers } from '../server/fns'

export const requestsQuery = () => queryOptions({ queryKey: ['requests'], queryFn: () => listRequests() })
export const peopleQuery = () => queryOptions({ queryKey: ['people'], queryFn: () => listPeople() })
export const usersQuery = () => queryOptions({ queryKey: ['users'], queryFn: () => listUsers() })
export const storageQuery = () => queryOptions({ queryKey: ['storage'], queryFn: () => getStorageSettings() })
