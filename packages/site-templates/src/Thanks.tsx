/** What a family sees after sending the form. The same words for a first enquiry and for one we already had: the reference goes by mail, never on the screen. */
export function EnquiryThanks({ child, phone }: { child?: string; phone?: string }) {
  return (
    <>
      <b>Thank you. We have your {child ? `enquiry for ${child}` : "message"}.</b>
      <p style={{ margin: "8px 0 0" }}>If you gave an email, your reference is on its way to it. The office has it as well.</p>
      <ol style={{ margin: "10px 0 0", paddingLeft: 20 }}>
        <li>Our office will call you within two working days.</li>
        <li>We will plan a school visit that suits you.</li>
        <li>You meet the teachers and see the classrooms. Then you decide.</li>
      </ol>
      {phone ? <p style={{ margin: "10px 0 0" }}>Need us sooner? Call <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>{phone}</a>.</p> : null}
    </>
  );
}
