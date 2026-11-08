import { StorageAccessFramework, writeAsStringAsync } from 'expo-file-system/legacy'
import appConfig from '../../app.json'
import { connectionLogText } from './connection-log'

/** The system folder picker grants access only to the user's chosen destination. */
export async function exportConnectionLog(): Promise<boolean> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync()
  if (!permission.granted) return false
  const name = `dsh-remote-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
  const uri = await StorageAccessFramework.createFileAsync(permission.directoryUri, name, 'text/plain')
  await writeAsStringAsync(uri, connectionLogText(appConfig.expo.version))
  return true
}
