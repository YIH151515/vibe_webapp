export default function Home(): React.JSX.Element {
  return (
    <main className="welcome">
      <p className="eyebrow">함께 나누는 이야기</p>
      <h1>자유 게시판</h1>
      <p className="intro">
        소소한 일상부터 궁금한 이야기까지, 편하게 나눌 공간을 준비하고 있어요.
      </p>
      <div className="notice">
        <h2>게시판 준비 중</h2>
        <p>글 목록과 작성 기능은 다음 작업에서 연결됩니다.</p>
      </div>
    </main>
  );
}
