import Item from './item'
import Reply from './reply'
import Comment from './comment'
import Text from './text'
import Comments from './comments'
import styles from '../styles/item.module.css'
import { NOFOLLOW_LIMIT } from '../lib/constants'
import { useMe } from './me'
import { Button } from 'react-bootstrap'
import { TwitterTweetEmbed } from 'react-twitter-embed'
import YouTube from 'react-youtube'
import useDarkMode from 'use-dark-mode'
import { useEffect, useRef, useState } from 'react'

function BioItem ({ item, handleClick }) {
  const me = useMe()
  if (!item.text) {
    return null
  }

  return (
    <>
      <ItemText item={item} />
      {me?.name === item.user.name &&
        <div className='text-right'>
          <Button
            onClick={handleClick}
            size='md' variant='link'
          >edit bio
          </Button>
        </div>}
      <Reply parentId={item.id} />
    </>
  )
}

function TweetSkeleton () {
  return (
    <div className={styles.tweetsSkeleton}>
      <div className={styles.tweetSkeleton}>
        <div className={`${styles.img} clouds`} />
        <div className={styles.content1}>
          <div className={`${styles.line} clouds`} />
          <div className={`${styles.line} clouds`} />
          <div className={`${styles.line} clouds`} />
        </div>
      </div>
    </div>
  )
}

function ItemEmbed ({ item }) {
  const darkMode = useDarkMode()
  const [overflowing, setOverflowing] = useState(false)
  const [show, setShow] = useState(false)
  const containerRef = useRef(null)

  const checkOverflow = () => {
    const cont = containerRef.current
    const over = cont && (cont.offsetHeight < cont.scrollHeight || cont.offsetWidth < cont.scrollWidth)

    if (over) {
      setOverflowing(true)
      return
    }

    setOverflowing(false)
  }

  useEffect(checkOverflow, [])

  const twitter = item.url?.match(/^https?:\/\/twitter\.com\/(?:#!\/)?\w+\/status(?:es)?\/(?<id>\d+)/)
  if (twitter?.groups?.id) {
    return (
      <div className={`${styles.twitterContainer} ${show ? '' : styles.twitterContained}`} ref={containerRef}>
        <TwitterTweetEmbed tweetId={twitter.groups.id} options={{ width: '550px', theme: darkMode.value ? 'dark' : 'light' }} placeholder={<TweetSkeleton />} onLoad={checkOverflow} />
        {overflowing && !show &&
          <Button size='lg' variant='info' className={styles.twitterShowFull} onClick={() => setShow(true)}>
            show full tweet
          </Button>}
      </div>
    )
  }

  const youtube = item.url?.match(/(https?:\/\/)?((www\.)?(youtube(-nocookie)?|youtube.googleapis)\.com.*(v\/|v=|vi=|vi\/|e\/|embed\/|user\/.*\/u\/\d+\/)|youtu\.be\/)(?<id>[_0-9a-z-]+)/i)
  if (youtube?.groups?.id) {
    return (
      <div style={{ maxWidth: '640px', paddingRight: '15px' }}>
        <YouTube videoId={youtube.groups.id} containerClassName={styles.youtubeContainer} />
      </div>
    )
  }

  return null
}

function TopLevelItem ({ item, noReply, ...props }) {
  return (
    <Item item={item} {...props}>
      {item.text && <ItemText item={item} />}
      {item.url && <ItemEmbed item={item} />}
      {!noReply && <Reply parentId={item.id} replyOpen />}
    </Item>
  )
}

function ItemText ({ item }) {
  return <Text nofollow={item.sats + item.boost < NOFOLLOW_LIMIT}>{item.searchText || item.text}</Text>
}

export default function ItemFull ({ item, bio, ...props }) {
  return (
    <>
      {item.parentId
        ? <Comment item={item} replyOpen includeParent noComments {...props} />
        : (
          <div className='mt-1'>{
          bio
            ? <BioItem item={item} {...props} />
            : <TopLevelItem item={item} {...props} />
          }
          </div>)}
      {item.comments &&
        <div className={styles.comments}>
          <Comments parentId={item.id} comments={item.comments} />
        </div>}
    </>
  )
}
