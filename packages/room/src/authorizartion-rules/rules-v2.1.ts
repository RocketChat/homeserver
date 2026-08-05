import { PersistentEventFactory } from "..";
import { PersistentEventBase } from "../manager/event-wrapper";


function isCreateAllowed(event: PersistentEventBase<'12', 'm.room.create'>): boolean {
    if (event.getPreviousEventIds().length > 0) {
        return false;
    }
    
    if (event.event.room_id) {
        // changed in this version
        return false;
    }
    
    // SPEC: If content.room_version is present and is not a recognised version, reject.
    if (!PersistentEventFactory.isSupportedRoomVersion( event.getContent().room_version)) {
        return false;
    }
    // SPEC: [New in this version] If additional_creators is present in content and is not an array of strings where each string passes the same user ID validation applied to sender, reject.
    // ^ TODO

    return true;
}