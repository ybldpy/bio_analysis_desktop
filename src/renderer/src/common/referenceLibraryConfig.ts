// Deployment switch, not automatic capability detection. The user confirmed the
// current backend supports target queries/uploads and membership confirmation on 2026-10-24.
// Set false before connecting to an older or unverified deployment; HTTP 200 is not proof.
export const referenceLibraryDeployment = {
  targetContextConfirmed: true
}
