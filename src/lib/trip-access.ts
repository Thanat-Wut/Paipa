export function actorCanAccessTrip(actorId: string, ownerId: string, memberIds: string[]) {
  return actorId === ownerId || memberIds.includes(actorId);
}
