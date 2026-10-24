import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorState, Loading } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { getPage, updatePage } from '../../services/library';
import { useFeedback } from '../../app/feedback';
import { PageEditor } from './PageEditor';

export default function EditPageRoute() {
  const { pageId = '' } = useParams();
  const nav = useNavigate();
  const fb = useFeedback();
  const page = useLive(() => getPage(pageId), [pageId]);
  const [busy, setBusy] = useState(false);
  if (page.loading) return <Loading />;
  if (!page.data) return <ErrorState title="Page not found" action={<button className="btn btn-primary" onClick={() => nav(-1)}>Back</button>} />;
  return (
    <PageEditor
      key={page.data.id}
      page={page.data}
      mode="edit"
      busy={busy}
      onCancel={() => nav(-1)}
      onConfirm={async (edits) => {
        setBusy(true);
        try {
          await updatePage(pageId, { edits });
          fb.toast('Page updated', 'success');
          nav(-1);
        } catch (e) {
          fb.error(e, 'Could not save the edit. The previous version is unchanged.');
          setBusy(false);
        }
      }}
    />
  );
}
