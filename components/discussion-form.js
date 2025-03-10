import { Form, Input, MarkdownInput, SubmitButton } from '../components/form'
import { useRouter } from 'next/router'
import { gql, useApolloClient, useLazyQuery, useMutation } from '@apollo/client'
import TextareaAutosize from 'react-textarea-autosize'
import Countdown from './countdown'
import AdvPostForm, { AdvPostInitial } from './adv-post-form'
import FeeButton, { EditFeeButton } from './fee-button'
import { ITEM_FIELDS } from '../fragments/items'
import AccordianItem from './accordian-item'
import Item from './item'
import Delete from './delete'
import { Button } from 'react-bootstrap'
import { discussionSchema } from '../lib/validate'
import { SubSelectInitial } from './sub-select-form'
import CancelButton from './cancel-button'

export function DiscussionForm ({
  item, sub, editThreshold, titleLabel = 'title',
  textLabel = 'text', buttonText = 'post',
  handleSubmit, children
}) {
  const router = useRouter()
  const client = useApolloClient()
  const schema = discussionSchema(client)
  // const me = useMe()
  const [upsertDiscussion] = useMutation(
    gql`
      mutation upsertDiscussion($sub: String, $id: ID, $title: String!, $text: String, $boost: Int, $forward: String) {
        upsertDiscussion(sub: $sub, id: $id, title: $title, text: $text, boost: $boost, forward: $forward) {
          id
        }
      }`
  )

  const [getRelated, { data: relatedData }] = useLazyQuery(gql`
  ${ITEM_FIELDS}
  query related($title: String!) {
    related(title: $title, minMatch: "75%", limit: 3) {
      items {
        ...ItemFields
      }
    }
  }`, {
    fetchPolicy: 'network-only'
  })

  const related = relatedData?.related?.items || []

  // const cost = linkOrImg ? 10 : me?.freePosts ? 0 : 1

  return (
    <Form
      initial={{
        title: item?.title || '',
        text: item?.text || '',
        ...AdvPostInitial({ forward: item?.fwdUser?.name }),
        ...SubSelectInitial({ sub: item?.subName || sub?.name })
      }}
      schema={schema}
      onSubmit={handleSubmit || (async ({ boost, ...values }) => {
        const { error } = await upsertDiscussion({
          variables: { sub: item?.subName || sub?.name, id: item?.id, boost: boost ? Number(boost) : undefined, ...values }
        })
        if (error) {
          throw new Error({ message: error.toString() })
        }

        if (item) {
          await router.push(`/items/${item.id}`)
        } else {
          const prefix = sub?.name ? `/~${sub.name}` : ''
          await router.push(prefix + '/recent')
        }
      })}
      storageKeyPrefix={item ? undefined : 'discussion'}
    >
      {children}
      <Input
        label={titleLabel}
        name='title'
        required
        autoFocus
        clear
        onChange={async (formik, e) => {
          if (e.target.value) {
            getRelated({
              variables: { title: e.target.value }
            })
          }
        }}
      />
      <MarkdownInput
        topLevel
        label={<>{textLabel} <small className='text-muted ml-2'>optional</small></>}
        name='text'
        as={TextareaAutosize}
        minRows={6}
        hint={editThreshold
          ? <div className='text-muted font-weight-bold'><Countdown date={editThreshold} /></div>
          : null}
      />
      <AdvPostForm edit={!!item} />
      <div className='mt-3'>
        {item
          ? (
            <div className='d-flex justify-content-between'>
              <Delete itemId={item.id} onDelete={() => router.push(`/items/${item.id}`)}>
                <Button variant='grey-medium'>delete</Button>
              </Delete>
              <div className='d-flex'>
                <CancelButton />
                <EditFeeButton
                  paidSats={item.meSats}
                  parentId={null} text='save' ChildButton={SubmitButton} variant='secondary'
                />
              </div>
            </div>)
          : <FeeButton
              baseFee={1} parentId={null} text={buttonText}
              ChildButton={SubmitButton} variant='secondary'
            />}
      </div>
      {!item &&
        <div className={`mt-3 ${related.length > 0 ? '' : 'invisible'}`}>
          <AccordianItem
            header={<div style={{ fontWeight: 'bold', fontSize: '92%' }}>similar</div>}
            body={
              <div>
                {related.map((item, i) => (
                  <Item item={item} key={item.id} />
                ))}
              </div>
              }
          />
        </div>}
    </Form>
  )
}
