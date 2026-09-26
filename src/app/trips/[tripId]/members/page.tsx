import Image from "next/image";
import { leaveTrip } from "@/actions/trips";
import { MemberAvatar, PageIntro, ErrorBox } from "@/components/ui";
import { MemberEditor } from "@/components/member-editor";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { tripContext, tripMembers } from "@/lib/data";
import { requireIdentity } from "@/lib/identity-server";

const attendanceLabel: Record<string, string> = {
  going: "ไปแน่นอน",
  maybe: "ยังไม่แน่ใจ",
  not_going: "ไปไม่ได้",
};

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}/members`);
  const [{ trip, userId }, members] = await Promise.all([tripContext(tripId, identity.id), tripMembers(tripId, identity.id)]);
  const self = members.find((member) => member.user_id === userId);
  const query = await searchParams;

  return (
    <>
      <PageIntro eyebrow="THE SQUAD 💛" title="เพื่อนร่วมทริป">
        ทุกคนที่ตอบรับคำชวนมาแล้ว
      </PageIntro>
      <ErrorBox message={query.error} />
      {trip.status === "archived" && <div className="notice-box" role="status">ทริปนี้เก็บถาวรแล้ว ข้อมูลสมาชิกและสถานะต่าง ๆ แสดงเพื่อดูย้อนหลังเท่านั้น</div>}
      <div className="members-layout">
        <section className="panel">
          <div className="section-heading">
            <h2>สมาชิก {members.length} คน</h2>
            <span>{members.filter((member) => member.attendance === "going").length} คนไปแน่นอน</span>
          </div>
          <div className="member-list">
            {members.map((member) => {
              const canViewSignature = member.signature_path
                && (member.user_id === userId || trip.owner_id === userId);

              return (
                <div className="member-row" key={member.id}>
                  <MemberAvatar name={member.display_name} url={member.avatar_url} size="large" />
                  <div className="member-detail">
                    <strong>
                      {member.display_name} {member.user_id === userId && <small>(คุณ)</small>}
                    </strong>
                    <span>
                      {member.role === "owner" ? "เจ้าของทริป" : "สมาชิก"}
                      {member.signature_path ? " · เซ็นแล้ว ✍️" : ""}
                    </span>
                  </div>
                  {canViewSignature && (
                    <Image
                      className="member-signature-image"
                      src={`/api/trips/${tripId}/members/${member.user_id}/signature`}
                      alt={`ลายเซ็นยืนยันว่าจะไปของ ${member.display_name}`}
                      width={72}
                      height={36}
                      unoptimized
                    />
                  )}
                  <span className={`attendance attendance-${member.attendance}`}>
                    {attendanceLabel[member.attendance]}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        {self && (
          <section className="panel profile-panel">
            <div className="section-heading">
              <h2>โปรไฟล์ในทริปนี้</h2>
              <span>แก้ไขได้ตลอด</span>
            </div>
            <MemberEditor
              tripId={tripId}
              initialName={self.display_name}
              initialAvatarUrl={self.avatar_url}
              initialAvatarType={self.avatar_type}
              initialSignaturePath={self.signature_path}
              initialAttendance={self.attendance}
              isArchived={trip.status === "archived"}
            />
            {self.role !== "owner" && trip.status !== "archived" && (
              <form action={leaveTrip} className="danger-inline">
                <input type="hidden" name="tripId" value={tripId} />
                <ConfirmSubmit className="text-button danger-text" message="ต้องการออกจากทริปนี้ใช่ไหม?">ออกจากทริปนี้</ConfirmSubmit>
              </form>
            )}
          </section>
        )}
      </div>
    </>
  );
}
