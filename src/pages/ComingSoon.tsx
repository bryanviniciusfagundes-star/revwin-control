import { Card, Empty, PageHeader } from '../components/ui';

export default function ComingSoon({ title, stage }: { title: string; stage: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <Empty title={`Disponível na ${stage}`}>Esta tela será construída na próxima etapa do desenvolvimento.</Empty>
      </Card>
    </>
  );
}
